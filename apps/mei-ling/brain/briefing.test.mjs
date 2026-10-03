import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvergreenBriefing,
  buildEvidenceBackedBriefing,
  clampSpokenSummary,
  evaluateNewsEvidence,
} from "./briefing.mjs";

const now = new Date("2026-08-03T10:00:00.000Z");
const item = {
  id: "intel-1",
  title: "Silent Hill: Townfall hands-on report",
  summary: "A first-party hands-on report.",
  sourceId: "playstation-blog",
  sourceName: "PlayStation Blog",
  sourceKind: "official",
  canonicalUrl: "https://blog.playstation.com/example/",
  published: "2026-08-03T07:00:24.000Z",
  relevanceScore: 82,
  confidence: 0.96,
};

test("clamps the spoken summary to 32 words", () => {
  const value = Array.from({ length: 40 }, (_, index) => `w${index}`).join(" ");
  assert.equal(words(clampSpokenSummary(value)).length, 32);
});

test("official primary evidence is confirmed, scored and recommended to cover", async () => {
  const result = await buildEvidenceBackedBriefing({
    items: [item],
    complete: async () => JSON.stringify({
      creatorAngle: "Confronta il tuo rapporto con la serie.",
      recordingMission: "Registra una reazione di novanta secondi.",
    }),
    now,
  });
  assert.equal(result.contentType, "news");
  assert.equal(result.sourceTier, "official-primary");
  assert.equal(result.claimStatus, "confirmed");
  assert.equal(result.recommendation, "cover");
  assert.ok(result.confidenceScore >= 75);
  assert.ok(result.channelFitScore >= 55);
  assert.ok(result.timelinessScore >= 75);
  assert.ok(result.opportunityScore >= 65);
  assert.match(result.whyItMatters, /verificabile/iu);
  assert.equal(result.evidence[0].url, item.canonicalUrl);
  assert.deepEqual(result.sourceIds, ["intel-1"]);
  assert.match(result.spokenSummary, /PlayStation Blog/iu);
  assert.match(result.spokenSummary, /confermata/iu);
  assert.match(result.spokenSummary, /raccomandazione/iu);
  assert.doesNotMatch(result.spokenSummary, /dimmi se merita/iu);
});

test("an aggregator remains reported and monitor even with strong channel fit", async () => {
  const result = await buildEvidenceBackedBriefing({
    items: [{
      ...item,
      id: "intel-google",
      sourceId: "google-horror",
      sourceName: "Google News — Horror psicologico",
      sourceKind: "aggregator",
      canonicalUrl: "https://news.google.com/example/",
      relevanceScore: 95,
      confidence: 0.9,
    }],
    complete: async () => JSON.stringify({
      creatorAngle: "Verifica il titolo con una fonte primaria.",
      recordingMission: "Monitora la storia prima di registrare.",
    }),
    now,
  });
  assert.equal(result.contentType, "news");
  assert.equal(result.sourceTier, "aggregator");
  assert.equal(result.claimStatus, "reported");
  assert.equal(result.recommendation, "monitor");
  assert.ok(result.confidenceScore <= 64);
  assert.ok(result.opportunityScore <= 69);
  assert.match(result.sourceAssessment, /non sufficiente/iu);
  assert.match(result.spokenSummary, /fonte primaria/iu);
  assert.equal(result.evidence[0].url, "https://news.google.com/example/");
});

test("low-quality evidence is skipped in favor of a clearly labeled evergreen", async () => {
  let modelCalled = false;
  const result = await buildEvidenceBackedBriefing({
    items: [{
      ...item,
      id: "intel-weak",
      sourceName: "Unknown repost",
      sourceKind: "unknown",
      canonicalUrl: "https://example.invalid/repost",
      published: "2025-01-01T00:00:00.000Z",
      relevanceScore: 10,
      confidence: 0.2,
    }],
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
    now,
  });
  const rejected = evaluateNewsEvidence({
    ...item,
    sourceKind: "unknown",
    published: "2025-01-01T00:00:00.000Z",
    relevanceScore: 10,
    confidence: 0.2,
  }, now);
  assert.equal(rejected.recommendation, "skip");
  assert.equal(rejected.claimStatus, "reported");
  assert.equal(rejected.sourceTier, "unknown");
  assert.equal(modelCalled, false);
  assert.equal(result.contentType, "evergreen");
  assert.equal(result.claimStatus, "evergreen");
  assert.equal(result.sourceTier, "evergreen");
  assert.equal(result.recommendation, "cover");
  assert.match(result.headline, /^Evergreen:/u);
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.sourceIds, []);
  assert.match(result.sourceAssessment, /non viene presentata come notizia/iu);
});

test("no-news evergreen selection is deterministic by calendar day", () => {
  const first = buildEvergreenBriefing(now);
  const repeated = buildEvergreenBriefing(new Date("2026-08-03T20:00:00.000Z"));
  assert.deepEqual(repeated, first);
  assert.equal(first.claimStatus, "evergreen");
  assert.match(first.whyItMatters, /Miura/iu);
});

test("evergreen day changes at Europe/Rome midnight rather than UTC midnight", () => {
  const beforeRomeMidnight = buildEvergreenBriefing(
    new Date("2026-08-03T21:30:00.000Z"),
  );
  const afterRomeMidnight = buildEvergreenBriefing(
    new Date("2026-08-03T22:30:00.000Z"),
  );
  const sameRomeDay = buildEvergreenBriefing(
    new Date("2026-08-04T10:00:00.000Z"),
  );
  assert.notEqual(afterRomeMidnight.headline, beforeRomeMidnight.headline);
  assert.deepEqual(sameRomeDay, afterRomeMidnight);
});

test("falls back deterministically when the model fails", async () => {
  const result = await buildEvidenceBackedBriefing({
    items: [item],
    complete: async () => {
      throw new Error("offline");
    },
    now,
  });
  assert.match(result.spokenSummary, /PlayStation Blog/u);
  assert.equal(result.evidence[0].title, item.title);
  assert.equal(result.recommendation, "cover");
});

function words(value) {
  return String(value).split(/\s+/u).filter(Boolean);
}
