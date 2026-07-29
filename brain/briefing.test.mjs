import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidenceBackedBriefing,
  clampSpokenSummary,
} from "./briefing.mjs";

const item = {
  id: "intel-1",
  title: "Silent Hill: Townfall hands-on report",
  summary: "A first-party hands-on report.",
  sourceId: "playstation-blog",
  sourceName: "PlayStation Blog",
  canonicalUrl: "https://blog.playstation.com/example/",
  published: "2026-07-29T07:00:24.000Z",
  relevanceScore: 42,
};

test("clamps the spoken summary to 32 words", () => {
  const value = Array.from({ length: 40 }, (_, index) => `w${index}`).join(" ");
  assert.equal(words(clampSpokenSummary(value)).length, 32);
});

test("uses only supplied evidence and preserves its URL", async () => {
  const result = await buildEvidenceBackedBriefing({
    items: [item],
    complete: async () => JSON.stringify({
      headline: item.title,
      spokenSummary: "Miura, PlayStation Blog ha pubblicato un approfondimento su Silent Hill: Townfall. Apri la fonte e registra la tua tesi.",
      creatorAngle: "Confronta il tuo rapporto con la serie.",
      recordingMission: "Registra una reazione di novanta secondi.",
    }),
  });
  assert.equal(result.evidence[0].url, item.canonicalUrl);
  assert.deepEqual(result.sourceIds, ["intel-1"]);
  assert.match(result.spokenSummary, /^Miura,/u);
});

test("falls back deterministically when the model fails", async () => {
  const result = await buildEvidenceBackedBriefing({
    items: [item],
    complete: async () => {
      throw new Error("offline");
    },
  });
  assert.match(result.spokenSummary, /PlayStation Blog/u);
  assert.equal(result.evidence[0].title, item.title);
});

function words(value) {
  return String(value).split(/\s+/u).filter(Boolean);
}
