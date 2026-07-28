import { afterEach, describe, expect, it, vi } from "vitest";
import localAi from "../electron/local-ai.cjs";

const {
  buildSignalCandidates,
  parseSceneTimes,
  parseSilences,
  requestOllamaVision,
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
