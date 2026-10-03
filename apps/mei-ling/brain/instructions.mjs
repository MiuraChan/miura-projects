const EXPLICIT_STANDING_PATTERNS = [
  /\bricordati(?:\s+che)?\b/iu,
  /\b(?:d['’]ora|da ora)\s+in\s+poi\b/iu,
  /\b(?:sempre|mai)\b/iu,
  /\bnon\s+(?:fare|chiamarmi|usare|dire)\b/iu,
  /\b(?:preferisco|voglio)\s+che\s+(?:tu|mei\s+ling)\b/iu,
  /\bdevi\s+sempre\b/iu,
  /\bremember(?:\s+that)?\b/iu,
  /\bfrom\s+now\s+on\b/iu,
  /\bnever\s+(?:do|call|use|say)\b/iu,
  /\balways\b/iu,
];

const TRANSIENT_PATTERNS = [
  /\b(?:oggi|stasera|adesso|ora|questa\s+volta|per\s+questa)\b/iu,
  /\b(?:today|tonight|right\s+now|this\s+time)\b/iu,
];

const CONDITIONAL_STANDING_PATTERNS = [
  /\b(?:quando|ogni\s+volta\s+che)\b[\s\S]{1,360}\b(?:devi|dovrai|voglio\s+che|shall|must|should)\b/iu,
  /\b(?:whenever|every\s+time\s+that|when)\b[\s\S]{1,360}\b(?:you\s+must|you\s+should|always)\b/iu,
];

export function extractStandingInstruction(message) {
  const text = String(message || "").replace(/\s+/gu, " ").trim();
  if (text.length < 8 || text.length > 600) return null;
  const isConditionalStandingRule = CONDITIONAL_STANDING_PATTERNS.some((pattern) => pattern.test(text));
  if (!isConditionalStandingRule && !EXPLICIT_STANDING_PATTERNS.some((pattern) => pattern.test(text))) return null;

  const hasStrongPersistenceMarker =
    /\b(?:ricordati|remember|d['’]ora|da ora|from now on|sempre|always|mai|never)\b/iu.test(text);
  if (!isConditionalStandingRule && !hasStrongPersistenceMarker && TRANSIENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return null;
  }

  return {
    text,
    source: "explicit-user-message",
    scope: "conversation",
  };
}
