"use strict";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rangesOverlap(a, b, padding = 0) {
  return a.start < b.end + padding && a.end > b.start - padding;
}

function removeSilencesFromRange(range, silences, minimumSegment = 0.7) {
  const relevant = silences
    .filter((silence) => silence.end - silence.start >= 0.45)
    .filter((silence) => rangesOverlap(range, silence))
    .sort((a, b) => a.start - b.start);
  const segments = [];
  let cursor = range.start;
  for (const silence of relevant) {
    const quietStart = clamp(silence.start + 0.08, range.start, range.end);
    const quietEnd = clamp(silence.end - 0.08, range.start, range.end);
    if (quietStart - cursor >= minimumSegment) {
      segments.push({ start: cursor, end: quietStart, reason: "kept-content" });
    }
    cursor = Math.max(cursor, quietEnd);
  }
  if (range.end - cursor >= minimumSegment) {
    segments.push({ start: cursor, end: range.end, reason: "kept-content" });
  }
  return segments.length ? segments : [{ start: range.start, end: range.end, reason: "continuous-content" }];
}

function trimSegmentsToDuration(segments, maximumDuration) {
  const output = [];
  let remaining = maximumDuration;
  for (const segment of segments) {
    if (remaining <= 0.05) break;
    const duration = segment.end - segment.start;
    const used = Math.min(duration, remaining);
    if (used >= 0.5) output.push({ ...segment, end: Number((segment.start + used).toFixed(3)) });
    remaining -= used;
  }
  return output;
}

function buildEditPlan({
  candidates,
  silences = [],
  sourceDuration,
  desiredDuration,
  direction = "",
  tone = "",
  maximumSegments = 8,
}) {
  const target = clamp(Number(desiredDuration) || sourceDuration, 2, sourceDuration);
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const selectedWindows = [];
  for (const candidate of ranked) {
    if (selectedWindows.some((selected) => rangesOverlap(selected, candidate, 0.35))) continue;
    selectedWindows.push(candidate);
    const selectedDuration = selectedWindows.reduce((total, item) => total + (item.end - item.start), 0);
    if (selectedDuration >= target * 1.35 || selectedWindows.length >= maximumSegments) break;
  }
  if (!selectedWindows.length) selectedWindows.push({ start: 0, end: Math.min(sourceDuration, target), score: 0 });

  const strongest = selectedWindows[0];
  const remaining = selectedWindows.slice(1).sort((a, b) => a.start - b.start);
  const wantsEnding = /(finish|ending|end on|close with|reveal|finale|conclud)/i.test(direction);
  let orderedWindows = [strongest, ...remaining];
  if (wantsEnding && remaining.length) {
    const ending = remaining.reduce((latest, item) => item.end > latest.end ? item : latest, remaining[0]);
    orderedWindows = [strongest, ...remaining.filter((item) => item !== ending), ending];
  }

  const contentSegments = orderedWindows
    .flatMap((window, windowIndex) => removeSilencesFromRange(window, silences).map((segment) => ({
      ...segment,
      score: window.score,
      role: windowIndex === 0 ? "hook" : (windowIndex === orderedWindows.length - 1 ? "close" : "body"),
    })))
    .filter((segment) => segment.end - segment.start >= 0.5);
  const segments = trimSegmentsToDuration(contentSegments, target).slice(0, maximumSegments);
  const outputDuration = segments.reduce((total, segment) => total + (segment.end - segment.start), 0);
  const coveredSpan = segments.length ? Math.max(...segments.map((segment) => segment.end)) - Math.min(...segments.map((segment) => segment.start)) : 0;
  return {
    strategy: `Direction-aware ${tone ? `${tone} ` : ""}multi-segment cut`,
    segments,
    sourceDuration: Number(sourceDuration.toFixed(3)),
    outputDuration: Number(outputDuration.toFixed(3)),
    removedDuration: Number(Math.max(0, coveredSpan - outputDuration).toFixed(3)),
    reordered: segments.some((segment, index) => index > 0 && segment.start < segments[index - 1].start),
  };
}

module.exports = {
  buildEditPlan,
  rangesOverlap,
  removeSilencesFromRange,
  trimSegmentsToDuration,
};
