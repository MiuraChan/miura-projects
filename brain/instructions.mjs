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

export function extractStandingInstruction(message) {
  const text = String(message || "").replace(/\s+/gu, " ").trim();
  if (text.length < 8 || text.length > 600) return null;
  if (!EXPLICIT_STANDING_PATTERNS.some((pattern) => pattern.test(text))) return null;

  const hasStrongPersistenceMarker =
    /\b(?:ricordati|remember|d['’]ora|da ora|from now on|sempre|always|mai|never)\b/iu.test(text);
  if (!hasStrongPersistenceMarker && TRANSIENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return null;
  }

  return {
    text,
    source: "explicit-user-message",
    scope: "conversation",
  };
}
