import { afterEach, describe, expect, it, vi } from "vitest";
import localAi from "../electron/local-ai.cjs";

const {
  buildSignalCandidates,
  parseSceneTimes,
  parseSilences,
  parseSubtitleCues,
  requestOllamaVision,
  extractDirectionRules,
  buildTimelineWindows,
  mergeExcludedTimelineRanges,
  applyMemeBeats,
  normalizeVisionScore,
  enforceVisibleDirectionDecision,
  hasPositiveVisibleMatch,
} = localAi;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Grayfox local AI signals", () => {
  it("parses real FFmpeg scene and silence logs", () => {
    expect(parseSceneTimes("pts_time:1.25 other pts_time:9.5")).toEqual([1.25, 9.5]);
    expect(parseSilences("silence_start: 2.0\nsilence_end: 4.5\nsilence_start: 8", 12))
      .toEqual([{ start: 2, end: 4.5 }, { start: 8, end: 12 }]);
  });

  it("parses subtitle dialogue and prioritizes the requested spoken topic", () => {
    const cues = parseSubtitleCues(`1\n00:00:10,000 --> 00:00:13,000\nWelcome to the show.\n\n2\n00:01:20,000 --> 00:01:25,000\nOur pricing includes support and updates.`);
    expect(cues).toEqual([
      { start: 10, end: 13, text: "Welcome to the show." },
      { start: 80, end: 85, text: "Our pricing includes support and updates." },
    ]);
    const candidates = buildSignalCandidates({
      duration: 120,
      targetLength: 12,
      sceneTimes: [3, 7, 40, 82],
      silences: [],
      dialogueCues: cues,
      direction: "Keep the complete pricing answer",
    });
    expect(candidates[0].dialogueExcerpt).toContain("pricing includes support");
    expect(candidates[0].dialogueMatches).toContain("pricing");
  });

  it("ranks candidates from measured scene density, silence and an energetic tone", () => {
    const candidates = buildSignalCandidates({
      duration: 120,
      targetLength: 20,
      sceneTimes: [2, 4, 6, 8, 10, 12, 14, 70],
      silences: [{ start: 60, end: 80 }],
      tone: "energetic, bold, funny",
      finalUse: "Paid social campaign",
      direction: "Open with a fast hook",
    });

    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(candidates[0].start).toBeLessThan(20);
    expect(candidates[0].score).toBeGreaterThan(candidates.at(-1).score);
    expect(candidates[0].memeScore).toBeGreaterThan(50);
    expect(candidates[0].metrics.cuts).toBeGreaterThan(0);
  });

  it("accepts structured semantic and meme rankings from the local vision model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            rankings: [{
              index: 0,
              semanticScore: 93,
              memeScore: 81,
              title: "Visible reaction",
              rationale: "The subject has an immediate readable expression.",
              memeReason: "The reaction leaves room for a caption.",
            }],
          }),
        },
      }),
    }));

    const result = await requestOllamaVision([{ start: 0, end: 10 }], ["ZmFrZQ=="], "funny hook");

    expect(result.model).toBe("qwen3-vl:2b-instruct");
    expect(result.rankings[0]).toEqual(expect.objectContaining({ semanticScore: 93, memeScore: 81 }));
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/chat",
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("Grayfox direction compliance", () => {
  it("normalizes fractional model scores and deterministically enforces visible removal rules", () => {
    expect(normalizeVisionScore(0.91)).toBe(91);
    expect(normalizeVisionScore(87)).toBe(87);
    expect(enforceVisibleDirectionDecision("keep", 10, "Assassin's Creed gameplay combat mission", {
      mustRemove: ["Cut more of the game, it is not important"],
    })).toEqual({ decision: "remove", confidence: 85, enforcedBy: "visible-gameplay-rule" });
    expect(hasPositiveVisibleMatch("There is no evidence of gameplay.", /gameplay|video game/i)).toBe(false);
    expect(hasPositiveVisibleMatch("Visible Assassin's Creed gameplay combat.", /gameplay|video game/i)).toBe(true);
    expect(enforceVisibleDirectionDecision("keep", 90, "Direct-to-camera storytelling with gameplay; there is no replay.", { mustRemove: ["Cut gameplay", "Remove the old episode"] }).decision).toBe("remove");
    expect(enforceVisibleDirectionDecision("keep", 20, "RECOVERY EPISODE 0 in a video player interface", {
      mustRemove: ["Remove the section where I rewatch the old episode"],
    })).toEqual({ decision: "remove", confidence: 82, enforcedBy: "visible-rewatch-rule" });
  });
  it("turns removal and priority language into explicit rules", () => {
    const rules = extractDirectionRules("Focus on the story. Remove the section where I rewatch the old episode. Cut more of the game, it is not important. Me talking is important.");
    expect(rules.mustRemove).toEqual(expect.arrayContaining([
      expect.stringMatching(/rewatch the old episode/i),
      expect.stringMatching(/game/i),
    ]));
    expect(rules.mustKeep).toEqual(expect.arrayContaining([
      expect.stringMatching(/story/i),
      expect.stringMatching(/talking/i),
    ]));
  });

  it("covers the entire source with bounded timeline windows", () => {
    const windows = buildTimelineWindows(4977.64, 60);
    expect(windows).toHaveLength(83);
    expect(windows[0]).toEqual({ start: 0, end: 60, sampleAt: 30 });
    expect(windows.at(-1).end).toBeCloseTo(4977.64, 2);
  });

  it("merges consecutive high-confidence removal windows", () => {
    const ranges = mergeExcludedTimelineRanges([
      { start: 540, end: 600, decision: "remove", confidence: 92, reason: "nested old episode", enforcedBy: "visible-rewatch-rule" },
      { start: 600, end: 660, decision: "remove", confidence: 88, reason: "continued replay", enforcedBy: "visible-rewatch-rule" },
      { start: 660, end: 720, decision: "neutral", confidence: 80, reason: "creator talking" },
      { start: 780, end: 840, decision: "remove", confidence: 90, reason: "same replay after a sparse sampling gap", enforcedBy: "visible-rewatch-rule" },
    ]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual(expect.objectContaining({ start: 540, end: 840 }));
  });

  it("adds no more than three grounded meme punches to selected moments", () => {
    const plan = { segments: [{ start: 0, end: 10 }, { start: 20, end: 30 }] };
    const count = applyMemeBeats(plan, [
      { start: 2, end: 4, decision: "keep", memeScore: 95, reason: "visible reaction" },
      { start: 22, end: 24, decision: "neutral", memeScore: 88, reason: "visual irony" },
    ]);
    expect(count).toBe(2);
    expect(plan.segments.every((segment) => segment.effect === "meme-punch")).toBe(true);
  });
});