import { describe, expect, it } from "vitest";
import planner from "../electron/edit-planner.cjs";

const { buildEditPlan, removeSilencesFromRange, trimSegmentsToDuration } = planner;

describe("Grayfox multi-segment edit planner", () => {
  it("removes measured pauses while preserving content on both sides", () => {
    const segments = removeSilencesFromRange(
      { start: 0, end: 10 },
      [{ start: 2.5, end: 4 }, { start: 7, end: 8.2 }]
    );

    expect(segments).toHaveLength(3);
    expect(segments[0].end).toBeCloseTo(2.58, 2);
    expect(segments[1].start).toBeCloseTo(3.92, 2);
    expect(segments[2].start).toBeCloseTo(8.12, 2);
  });

  it("builds a real hook/body/close timeline from non-overlapping ranked windows", () => {
    const plan = buildEditPlan({
      candidates: [
        { start: 40, end: 50, score: 96 },
        { start: 5, end: 15, score: 88 },
        { start: 75, end: 85, score: 82 },
      ],
      silences: [{ start: 45, end: 46.5 }, { start: 10, end: 11 }],
      sourceDuration: 90,
      desiredDuration: 24,
      direction: "Open with the result and end on the final reveal",
      tone: "direct",
    });

    expect(plan.segments.length).toBeGreaterThanOrEqual(4);
    expect(plan.segments[0]).toEqual(expect.objectContaining({ role: "hook", start: 40 }));
    expect(plan.segments.at(-1).role).toBe("close");
    expect(plan.outputDuration).toBeLessThanOrEqual(24);
    expect(plan.removedDuration).toBeGreaterThan(0);
    expect(plan.reordered).toBe(true);
  });

  it("trims the final segment instead of exceeding the requested duration", () => {
    const segments = trimSegmentsToDuration([
      { start: 0, end: 4 },
      { start: 10, end: 15 },
    ], 6);

    expect(segments).toEqual([
      { start: 0, end: 4 },
      { start: 10, end: 12 },
    ]);
  });
});
