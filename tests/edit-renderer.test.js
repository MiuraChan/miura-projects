import { describe, expect, it } from "vitest";
import renderer from "../electron/edit-renderer.cjs";

const { cleanSegments, concatFileEntry, formatTimestamp, summarizeFfmpegFailure, videoFilterForSegment } = renderer;

describe("Grayfox resilient edit renderer", () => {
  it("formats long-video ranges for actionable errors", () => {
    expect(formatTimestamp(2226)).toBe("37:06");
    expect(formatTimestamp(3726)).toBe("1:02:06");
  });

  it("converts decoder corruption into a useful segment warning", () => {
    const message = summarizeFfmpegFailure(
      "Invalid NAL unit size; partial file; no frame!",
      { start: 2226, end: 2236 },
      0
    );
    expect(message).toContain("Segment 1 (37:06–37:16)");
    expect(message).toContain("incomplete or damaged");
    expect(message).not.toContain("NAL");
  });

  it("bounds supplied segments to the real source duration", () => {
    expect(cleanSegments([
      { start: -4, end: 2, role: "hook" },
      { start: 99, end: 120, role: "close" },
    ], 100)).toEqual([
      { start: 0, end: 2, role: "hook" },
      { start: 99, end: 100, role: "close" },
    ]);
  });

  it("places an enabled meme punch only inside its chosen local time", () => {
    const filter = videoFilterForSegment({ start: 10, end: 20, effect: "meme-punch", memeEnabled: true, memeStart: 12.5, memeEnd: 13.7 });
    expect(filter).toContain("between(t,2.500,3.700)");
    expect(videoFilterForSegment({ start: 10, end: 20, effect: "meme-punch", memeEnabled: false })).not.toContain("overlay");
  });
  it("writes concat entries with portable forward slashes", () => {
    expect(concatFileEntry("C:\\Grayfox\\segment-001.mp4")).toBe("file 'C:/Grayfox/segment-001.mp4'");
  });

  it("preserves only approved meme punch effects", () => {
    expect(cleanSegments([
      { start: 1, end: 4, role: "body", effect: "meme-punch", memeStart: 2, memeEnd: 3.2 },
      { start: 5, end: 8, role: "body", effect: "unknown" },
    ], 10)).toEqual([
      { start: 1, end: 4, role: "body", effect: "meme-punch", memeEnabled: true, memeStart: 2, memeEnd: 3.2 },
      { start: 5, end: 8, role: "body" },
    ]);
  });
});
