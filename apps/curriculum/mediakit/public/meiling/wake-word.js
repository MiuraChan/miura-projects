// Keep the grammar deliberately small: wake recognition may be forgiving about
// how speech-to-text spells the name, but the whole utterance must still be the
// wake control phrase. This prevents "Mei Ling, ci sei? Cerca le news" from
// being swallowed as a control event instead of reaching the conversation.
const WAKE_PREFIXES = new Set(["hey", "ehi", "hei", "ei", "eh", "ai", "hai"]);
const WAKE_NAMES = new Set([
  "mei ling",
  "mei lin",
  "mei link",
  "mei linc",
  "mei li",
  "meiling",
  "meling",
  "mi ling",
  "mi lin",
  "miling",
  "mai ling",
  "mai lin",
  "mailing",
  "may ling",
  "may lin",
  "mayling",
  "miei ling",
  "miei link",
]);
const WAKE_ENDINGS = Object.freeze(["ci sei", "ci 6"]);
const POLITE_SUFFIXES = Object.freeze(["per favore", "please"]);

export function normalizeWakePhrase(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("it")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isMeiLingWakePhrase(value) {
  let normalized = normalizeWakePhrase(value);
  if (!normalized) return false;

  const firstSpace = normalized.indexOf(" ");
  const firstToken = firstSpace === -1 ? normalized : normalized.slice(0, firstSpace);
  if (WAKE_PREFIXES.has(firstToken)) {
    normalized = normalized.slice(firstToken.length).trim();
  }

  for (const suffix of POLITE_SUFFIXES) {
    if (normalized.endsWith(` ${suffix}`)) {
      normalized = normalized.slice(0, -(suffix.length + 1)).trim();
      break;
    }
  }

  for (const ending of WAKE_ENDINGS) {
    if (!normalized.endsWith(` ${ending}`)) continue;
    const name = normalized.slice(0, -(ending.length + 1)).trim();
    return WAKE_NAMES.has(name);
  }
  return false;
}

export const wakePhraseLabel = "Hey Mei Ling, ci sei?";
