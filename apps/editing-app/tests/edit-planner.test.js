import { describe, expect, it } from "vitest";
import planner from "../electron/edit-planner.cjs";

const { buildEditPlan, protectDialogueBoundaries, removeSilencesFromRange, tonePacingProfile, trimSegmentsToDuration } = planner;

describe("Grayfox multi-segment edit planner", () => {
  it("turns the current serious, energetic, direct and irreverent tags into an energetic profile", () => {
    expect(tonePacingProfile("Serious, Energetic, Direct, Irreverent")).toEqual(expect.objectContaining({
      id: "energetic-direct",
      label: "Energetic / direct",
      chapterSeconds: 90,
      memeThreshold: 68,
    }));
  });

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

  it("does not cut through a spoken subtitle cue", () => {
    const segments = protectDialogueBoundaries(
      [{ start: 5, end: 10, role: "body" }],
      [{ start: 9.5, end: 11.2, text: "complete answer" }],
      30,
    );
    expect(segments[0].end).toBeCloseTo(11.28, 2);
    expect(segments[0].dialogueProtected).toBe(true);
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

  it("locks a forty-minute long-form production to the requested duration", () => {
    const plan = buildEditPlan({
      candidates: [
        { start: 100, end: 120, score: 70 },
        { start: 900, end: 920, score: 96 },
        { start: 1800, end: 1820, score: 84 },
      ],
      silences: [
        { start: 300, end: 330 },
        { start: 900, end: 930 },
        { start: 1500, end: 1530 },
        { start: 2100, end: 2130 },
      ],
      sourceDuration: 2700,
      desiredDuration: 2400,
      direction: "Create a forty-minute YouTube production and remove dead air",
      tone: "natural",
    });

    expect(plan.strategy).toContain("long-form production");
    expect(plan.requestedDuration).toBe(2400);
    expect(plan.outputDuration).toBeCloseTo(2400, 2);
    expect(plan.durationLocked).toBe(true);
    expect(plan.reordered).toBe(false);
    expect(plan.segments.length).toBeGreaterThan(1);
    expect(plan.segments[0].role).toBe("hook");
    expect(plan.segments.at(-1).role).toBe("close");
    expect(plan.segments.every((segment, index) => index === 0 || segment.start >= plan.segments[index - 1].end)).toBe(true);
  });

  it("uses tone tags to produce measurably different long-form pacing", () => {
    const request = {
      candidates: [
        { start: 100, end: 140, score: 70 },
        { start: 900, end: 950, score: 96 },
        { start: 1800, end: 1850, score: 84 },
        { start: 2800, end: 2850, score: 88 },
      ],
      silences: [
        { start: 115, end: 116 },
        { start: 920, end: 920.5 },
        { start: 1820, end: 1820.6 },
        { start: 2820, end: 2821 },
      ],
      sourceDuration: 3600,
      desiredDuration: 1200,
      minimumDuration: 1200,
      maximumDuration: 1200,
      direction: "Keep the story",
    };
    const energetic = buildEditPlan({ ...request, tone: "Serious, Energetic, Direct, Irreverent" });
    const calm = buildEditPlan({ ...request, tone: "Calm, warm, reflective" });
    const averageLength = (plan) => plan.outputDuration / plan.segments.length;

    expect(energetic.toneProfile.id).toBe("energetic-direct");
    expect(calm.toneProfile.id).toBe("calm-measured");
    expect(energetic.segments.length).toBeGreaterThan(calm.segments.length);
    expect(averageLength(energetic)).toBeLessThan(averageLength(calm));
    expect(energetic.outputDuration).toBeCloseTo(1200, 2);
    expect(calm.outputDuration).toBeCloseTo(1200, 2);
  });

  it("keeps explicit minimum and maximum bounds in the edit plan", () => {
    const plan = buildEditPlan({
      candidates: [{ start: 20, end: 90, score: 96 }, { start: 180, end: 260, score: 88 }],
      sourceDuration: 600,
      desiredDuration: 300,
      minimumDuration: 120,
      maximumDuration: 300,
      direction: "Keep the story",
    });

    expect(plan.minimumDuration).toBe(120);
    expect(plan.maximumDuration).toBe(300);
    expect(plan.outputDuration).toBeGreaterThanOrEqual(120);
    expect(plan.outputDuration).toBeLessThanOrEqual(300);
    expect(plan.durationLocked).toBe(true);
  });

  it("never crosses hard exclusion ranges while filling a long target", () => {
    const plan = buildEditPlan({
      candidates: [
        { start: 300, end: 360, score: 80 },
        { start: 1800, end: 1860, score: 96 },
        { start: 3600, end: 3660, score: 88 },
      ],
      sourceDuration: 4977.64,
      desiredDuration: 1800,
      direction: "Remove the old episode and keep me talking",
      excludedRanges: [
        { start: 540, end: 1680, reason: "old episode" },
        { start: 2100, end: 2400, reason: "gameplay" },
      ],
    });

    expect(plan.hardExclusionsApplied).toBe(true);
    expect(plan.outputDuration).toBeCloseTo(1800, 2);
    expect(plan.segments.every((segment) =>
      plan.excludedRanges.every((range) => segment.end <= range.start || segment.start >= range.end)
    )).toBe(true);
  });

  it("treats exclusions as hard constraints for short edits and duration fill", () => {
    const plan = buildEditPlan({
      candidates: [
        { start: 60, end: 90, score: 99 },
        { start: 300, end: 340, score: 92 },
        { start: 380, end: 430, score: 88 },
      ],
      sourceDuration: 480,
      desiredDuration: 120,
      direction: "Remove the Starting Soon opening and keep direct-to-camera speech",
      excludedRanges: [{ start: 0, end: 280, reason: "Starting Soon" }],
    });

    expect(plan.hardExclusionsApplied).toBe(true);
    expect(plan.outputDuration).toBeCloseTo(120, 2);
    expect(plan.segments.every((segment) => segment.start >= 280)).toBe(true);
    expect(plan.segments.every((segment) => plan.excludedRanges.every((range) => !planner.rangesOverlap(segment, range)))).toBe(true);
  });
});
