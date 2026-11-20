const ITALIAN_WORDS = new Set([
  "ciao", "salve", "buongiorno", "buonasera", "grazie", "vai", "procedi",
  "oggi", "notizia", "notizie", "gioco", "giochi", "contenuto", "contenuti",
  "settimana", "piano", "calendario", "dimmi", "voglio", "posso", "puoi",
  "come", "cosa", "sono", "sei", "che", "per", "con", "della", "degli",
]);

const ENGLISH_WORDS = new Set([
  "hello", "hi", "hey", "thanks", "thank", "go", "proceed", "today", "news",
  "game", "games", "gaming", "content", "week", "weekly", "plan", "calendar",
  "tell", "want", "can", "could", "please", "what", "how", "you", "your",
  "the", "and", "with", "this", "that", "are", "is",
]);

export function normalizeSupportedLanguage(value, fallback = "it") {
  const candidate = String(value || "").trim().toLowerCase();
  if (candidate === "en" || candidate.startsWith("en-")) return "en";
  if (candidate === "it" || candidate.startsWith("it-")) return "it";
  const safeFallback = String(fallback || "it").trim().toLowerCase();
  return safeFallback === "en" || safeFallback.startsWith("en-") ? "en" : "it";
}

export function detectSupportedLanguage(value) {
  const text = String(value || "").normalize("NFKC").toLowerCase().trim();
  if (!text) return null;
  if (/[àèéìòù]/u.test(text)) return "it";
  const words = text.match(/[\p{L}\p{M}]+/gu) || [];
  let italian = 0;
  let english = 0;
  for (const word of words) {
    if (ITALIAN_WORDS.has(word)) italian += 1;
    if (ENGLISH_WORDS.has(word)) english += 1;
  }
  if (italian > english) return "it";
  if (english > italian) return "en";
  return null;
}

export function resolveSupportedLanguage({
  text = "",
  current,
  browser,
  fallback = "it",
} = {}) {
  return detectSupportedLanguage(text)
    || normalizeSupportedLanguage(current, normalizeSupportedLanguage(browser, fallback));
}
