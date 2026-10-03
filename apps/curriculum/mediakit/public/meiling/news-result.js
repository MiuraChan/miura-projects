const NEWS_RESULT_LIMIT = 3;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;

function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function isPrivateOrReservedIpv4(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
  const octets = hostname.split(".").map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const [first, second, third] = octets;
  return (
    first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 88 && third === 99)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224
  );
}

export function safeNewsUrl(value) {
  const raw = cleanText(value, 2_048);
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
    if (
      !hostname
      || hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || hostname === "home.arpa"
      || hostname.endsWith(".home.arpa")
      || hostname.includes(":")
      || isPrivateOrReservedIpv4(hostname)
    ) {
      return "";
    }

    return parsed.href;
  } catch {
    return "";
  }
}

export function editorialRatingLabel(score) {
  if (score >= 80) return "ALTO";
  if (score >= 60) return "BUONO";
  if (score >= 40) return "MEDIO";
  return "BASSO";
}

function normalizeEditorialRating(value, result) {
  const rating = value && typeof value === "object" ? value : { score: value };
  const numericScore = Number(rating.score);
  const score = Number.isFinite(numericScore)
    ? Math.round(Math.min(100, Math.max(0, numericScore)))
    : 0;
  const verificationRequired = Boolean(
    rating.verificationRequired
      ?? result.verificationRequired
      ?? (cleanText(result.claimStatus, 32).toLowerCase() !== "verified"),
  );
  const reasons = Array.isArray(rating.reasons)
    ? rating.reasons.map((reason) => cleanText(reason, 180)).filter(Boolean).slice(0, 3)
    : [];

  return {
    score,
    label: editorialRatingLabel(score),
    verificationRequired,
    reasons,
  };
}

export function normalizeNewsResults(results) {
  if (!Array.isArray(results)) return [];

  const normalized = [];
  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const title = cleanText(result.title, 280);
    const url = safeNewsUrl(result.url);
    if (!title || !url) continue;

    normalized.push({
      title,
      source: cleanText(result.source || result.aggregator, 120),
      publishedAt: cleanText(result.publishedAt, 80),
      url,
      editorialRating: normalizeEditorialRating(result.editorialRating, result),
    });

    if (normalized.length >= NEWS_RESULT_LIMIT) break;
  }

  return normalized;
}
