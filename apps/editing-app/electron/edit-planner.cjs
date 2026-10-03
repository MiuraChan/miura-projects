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

function mergeRanges(ranges) {
  const sorted = ranges
    .filter((range) => range.end - range.start > 0.01)
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 0.01) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function complementRanges(sourceDuration, removedRanges) {
  const removed = mergeRanges(removedRanges);
  const kept = [];
  let cursor = 0;
  for (const range of removed) {
    const start = clamp(range.start, 0, sourceDuration);
    const end = clamp(range.end, start, sourceDuration);
    if (start - cursor >= 0.5) kept.push({ start: cursor, end: start, reason: "long-form-content" });
    cursor = Math.max(cursor, end);
  }
  if (sourceDuration - cursor >= 0.5) kept.push({ start: cursor, end: sourceDuration, reason: "long-form-content" });
  return kept;
}

function subtractRangesFromSegments(segments, removedRanges) {
  const removed = mergeRanges(removedRanges);
  return segments.flatMap((segment) => {
    let pieces = [{ ...segment }];
    for (const range of removed) {
      pieces = pieces.flatMap((piece) => {
        if (!rangesOverlap(piece, range)) return [piece];
        const output = [];
        if (range.start - piece.start >= 0.5) output.push({ ...piece, end: range.start });
        if (piece.end - range.end >= 0.5) output.push({ ...piece, start: range.end });
        return output;
      });
    }
    return pieces;
  });
}

function fillSegmentsToDuration(segments, sourceDuration, target, excludedRanges) {
  const selected = mergeRanges(segments);
  const currentDuration = selected.reduce((total, segment) => total + segment.end - segment.start, 0);
  if (currentDuration >= target - 0.05) return trimSegmentsToDuration(selected, target);
  const unavailable = mergeRanges([...(excludedRanges || []), ...selected]);
  const available = complementRanges(sourceDuration, unavailable);
  const additions = trimSegmentsToDuration(available, target - currentDuration)
    .map((segment) => ({ ...segment, reason: "duration-fill-approved-content" }));
  return trimSegmentsToDuration(mergeRanges([...selected, ...additions]), target);
}
function sliceSegmentsByContentTime(segments, startOffset, duration) {
  const output = [];
  let cursor = 0;
  const selectionEnd = startOffset + duration;
  for (const segment of segments) {
    const segmentDuration = segment.end - segment.start;
    const segmentStart = cursor;
    const segmentEnd = cursor + segmentDuration;
    const overlapStart = Math.max(segmentStart, startOffset);
    const overlapEnd = Math.min(segmentEnd, selectionEnd);
    if (overlapEnd - overlapStart >= 0.5) {
      output.push({
        ...segment,
        start: Number((segment.start + overlapStart - segmentStart).toFixed(3)),
        end: Number((segment.start + overlapEnd - segmentStart).toFixed(3)),
      });
    }
    cursor = segmentEnd;
    if (cursor >= selectionEnd) break;
  }
  return output;
}

function coalesceSegmentsToLimit(rawSegments, limit) {
  const segments = rawSegments.map((segment) => ({ ...segment }));
  while (segments.length > limit) {
    let smallestGapIndex = 0;
    let smallestGap = Infinity;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const gap = segments[index + 1].start - segments[index].end;
      if (gap < smallestGap) {
        smallestGap = gap;
        smallestGapIndex = index;
      }
    }
    segments.splice(smallestGapIndex, 2, {
      ...segments[smallestGapIndex],
      end: segments[smallestGapIndex + 1].end,
      reason: "coalesced-long-form-content",
    });
  }
  return segments;
}

function assignRoles(segments) {
  return segments.map((segment, index) => ({
    ...segment,
    role: index === 0 ? "hook" : (index === segments.length - 1 ? "close" : "body"),
  }));
}

function buildLongFormSegments({ candidates, silences, sourceDuration, target, maximumSegments, excludedRanges = [] }) {
  if (target >= sourceDuration - 0.05 && !excludedRanges.length) {
    return assignRoles([{ start: 0, end: sourceDuration, reason: "full-source-production" }]);
  }

  const ratio = target / sourceDuration;
  const strongest = [...candidates].sort((a, b) => b.score - a.score)[0];
  let segments;
  if (ratio >= 0.65) {
    let removalBudget = sourceDuration - target;
    const removableSilences = silences
      .map((silence) => ({ start: silence.start + 0.08, end: silence.end - 0.08 }))
      .filter((silence) => silence.end - silence.start >= 0.45)
      .sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const removals = [];
    for (const silence of removableSilences) {
      if (removalBudget <= 0.05) break;
      const silenceDuration = silence.end - silence.start;
      const removedDuration = Math.min(silenceDuration, removalBudget);
      const center = (silence.start + silence.end) / 2;
      removals.push({ start: center - removedDuration / 2, end: center + removedDuration / 2 });
      removalBudget -= removedDuration;
    }
    const chronologicalContent = complementRanges(sourceDuration, removals);
    const contentDuration = chronologicalContent.reduce((total, segment) => total + segment.end - segment.start, 0);
    const anchor = strongest ? (strongest.start + strongest.end) / 2 : sourceDuration / 2;
    let anchorOffset = 0;
    for (const segment of chronologicalContent) {
      if (anchor >= segment.end) anchorOffset += segment.end - segment.start;
      else if (anchor > segment.start) { anchorOffset += anchor - segment.start; break; }
      else break;
    }
    const selectionStart = clamp(anchorOffset - target * 0.15, 0, Math.max(0, contentDuration - target));
    segments = sliceSegmentsByContentTime(chronologicalContent, selectionStart, target);
  } else {
    const chapterCount = clamp(Math.ceil(target / 300), 2, Math.min(12, maximumSegments));
    const chapterDuration = sourceDuration / chapterCount;
    const outputPerChapter = target / chapterCount;
    segments = Array.from({ length: chapterCount }, (_value, index) => {
      const chapterStart = index * chapterDuration;
      const chapterEnd = index === chapterCount - 1 ? sourceDuration : (index + 1) * chapterDuration;
      const candidate = candidates
        .filter((item) => item.start < chapterEnd && item.end > chapterStart)
        .sort((a, b) => b.score - a.score)[0];
      const anchor = candidate ? (candidate.start + candidate.end) / 2 : (chapterStart + chapterEnd) / 2;
      const latestStart = Math.max(chapterStart, chapterEnd - outputPerChapter);
      const start = clamp(anchor - outputPerChapter / 2, chapterStart, latestStart);
      return { start, end: Math.min(chapterEnd, start + outputPerChapter), reason: "chapter-selection" };
    });
  }

  segments = subtractRangesFromSegments(segments, excludedRanges);
  segments = fillSegmentsToDuration(segments, sourceDuration, target, excludedRanges);
  if (!excludedRanges.length) segments = coalesceSegmentsToLimit(mergeRanges(segments), maximumSegments);
  segments = trimSegmentsToDuration(segments, target);
  return assignRoles(segments);
}

function protectDialogueBoundaries(segments, dialogueCues, sourceDuration) {
  return segments.map((segment) => {
    let start = segment.start;
    let end = segment.end;
    for (const cue of dialogueCues) {
      if (cue.start < start && cue.end > start) start = Math.max(0, cue.start - 0.08);
      if (cue.start < end && cue.end > end) end = Math.min(sourceDuration, cue.end + 0.08);
    }
    return { ...segment, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)), dialogueProtected: start !== segment.start || end !== segment.end };
  });
}

function buildEditPlan({
  candidates,
  silences = [],
  dialogueCues = [],
  sourceDuration,
  desiredDuration,
  direction = "",
  tone = "",
  maximumSegments = 48,
  excludedRanges = [],
}) {
  const target = clamp(Number(desiredDuration) || sourceDuration, 2, sourceDuration);
  if (target > 120) {
    const segments = buildLongFormSegments({ candidates, silences, sourceDuration, target, maximumSegments, excludedRanges });
    const outputDuration = segments.reduce((total, segment) => total + (segment.end - segment.start), 0);
    return {
      strategy: `Duration-locked ${tone ? `${tone} ` : ""}long-form production`,
      segments,
      sourceDuration: Number(sourceDuration.toFixed(3)),
      requestedDuration: Number(target.toFixed(3)),
      outputDuration: Number(outputDuration.toFixed(3)),
      removedDuration: Number(Math.max(0, sourceDuration - outputDuration).toFixed(3)),
      reordered: false,
      durationLocked: Math.abs(outputDuration - target) <= Math.max(1, target * 0.01),
      excludedRanges: mergeRanges(excludedRanges),
      hardExclusionsApplied: excludedRanges.length > 0,
    };
  }

  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const selectedWindows = [];
  const shortSegmentLimit = Math.min(8, maximumSegments);
  for (const candidate of ranked) {
    if (selectedWindows.some((selected) => rangesOverlap(selected, candidate, 0.35))) continue;
    selectedWindows.push(candidate);
    const selectedDuration = selectedWindows.reduce((total, item) => total + (item.end - item.start), 0);
    if (selectedDuration >= target * 1.35 || selectedWindows.length >= shortSegmentLimit) break;
  }
  if (!selectedWindows.length) selectedWindows.push({ start: 0, end: Math.min(sourceDuration, target), score: 0 });

  const strongest = selectedWindows[0];
  const remaining = selectedWindows.slice(1).sort((a, b) => a.start - b.start);
  const wantsEnding = /(finish|ending|end on|close with|reveal|finale|conclud)/i.test(direction);
  const preserveDialogue = /(dialogue|conversation|interview|answer|speech|dialogo|conversazione|intervista|risposta|parla)/i.test(direction);
  const explicitlyChronological = /(chronological|in order|same order|cronologic|stesso ordine)/i.test(direction);
  let orderedWindows = preserveDialogue || explicitlyChronological
    ? [...selectedWindows].sort((a, b) => a.start - b.start)
    : [strongest, ...remaining];
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
  let segments = trimSegmentsToDuration(contentSegments, target).slice(0, shortSegmentLimit);
  if (preserveDialogue && dialogueCues.length) segments = protectDialogueBoundaries(segments, dialogueCues, sourceDuration);
  const outputDuration = segments.reduce((total, segment) => total + (segment.end - segment.start), 0);
  const coveredSpan = segments.length ? Math.max(...segments.map((segment) => segment.end)) - Math.min(...segments.map((segment) => segment.start)) : 0;
  return {
    strategy: `Direction-aware ${tone ? `${tone} ` : ""}multi-segment cut`,
    segments,
    sourceDuration: Number(sourceDuration.toFixed(3)),
    requestedDuration: Number(target.toFixed(3)),
    outputDuration: Number(outputDuration.toFixed(3)),
    removedDuration: Number(Math.max(0, coveredSpan - outputDuration).toFixed(3)),
    reordered: segments.some((segment, index) => index > 0 && segment.start < segments[index - 1].start),
    durationLocked: outputDuration >= target * 0.9,
  };
}

module.exports = {
  buildEditPlan,
  buildLongFormSegments,
  subtractRangesFromSegments,
  fillSegmentsToDuration,
  coalesceSegmentsToLimit,
  complementRanges,
  protectDialogueBoundaries,
  rangesOverlap,
  removeSilencesFromRange,
  sliceSegmentsByContentTime,
  trimSegmentsToDuration,
};
