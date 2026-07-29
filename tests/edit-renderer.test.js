import { describe, expect, it } from "vitest";
import renderer from "../electron/edit-renderer.cjs";

const { cleanSegments, concatFileEntry, formatTimestamp, summarizeFfmpegFailure } = renderer;

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

  it("writes concat entries with portable forward slashes", () => {
    expect(concatFileEntry("C:\\Grayfox\\segment-001.mp4")).toBe("file 'C:/Grayfox/segment-001.mp4'");
  });
});
