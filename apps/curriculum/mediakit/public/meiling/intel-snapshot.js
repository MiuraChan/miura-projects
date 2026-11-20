const SNAPSHOT_URL = new URL("./intel-snapshot.json?v=38", import.meta.url).href;
const MAX_SNAPSHOT_AGE_MS = 8 * 86_400_000;
const TREND_TOPIC_IDS = new Set(["kojima", "fromsoftware"]);
let snapshotPromise = null;

function compactText(value, maxLength = 500) {
  return String(value || "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeIntelLanguage(value = "it") {
  const primaryLanguage = compactText(value, 32).toLocaleLowerCase("en")
    .replace(/_/gu, "-").split("-")[0];
  return primaryLanguage === "en" ? "en" : "it";
}

function translatedTitles(raw) {
  const italian = compactText(raw?.titleIt || raw?.titles?.it, 280);
  const english = compactText(raw?.titleEn || raw?.titles?.en, 280);
  return italian && english ? Object.freeze({ it: italian, en: english }) : null;
}

function normalizeEvidence(raw, language) {
  const titles = translatedTitles(raw);
  const title = titles?.[language] || "";
  const source = compactText(raw?.source, 120);
  const url = safeHttpsUrl(raw?.url);
  const publishedAt = new Date(raw?.publishedAt || "");
  if (!title || !source || !url || !Number.isFinite(publishedAt.getTime())) return null;
  const rawRating = raw?.rating && typeof raw.rating === "object"
    ? raw.rating
    : Number.isFinite(Number(raw?.rating))
      ? {
          score: Number(raw.rating),
          label: raw.ratingLabel,
          verificationRequired: raw.verificationRequired,
          reasons: raw.ratingReasons,
        }
      : raw?.editorialRating;
  const score = Math.max(0, Math.min(100, Math.round(Number(rawRating?.score ?? rawRating) || 0)));
  return Object.freeze({
    title,
    originalTitle: compactText(raw?.originalTitle || raw?.title, 280),
    source,
    url,
    publishedAt: publishedAt.toISOString(),
    language,
    sourceLanguage: compactText(raw?.sourceLanguage || raw?.language, 16),
    topic: compactText(raw?.topic || raw?.topicId, 120),
    topicLabel: compactText(raw?.topicLabel || raw?.topic || raw?.topicId, 120),
    sourceTier: compactText(raw?.sourceTier, 32) || "aggregator",
    claimStatus: "unconfirmed",
    editorialRating: Object.freeze({
      score,
      label: compactText(rawRating?.label || raw?.ratingLabel, 24),
      verificationRequired: rawRating?.verificationRequired !== false,
      reasons: Object.freeze((Array.isArray(rawRating?.reasons) ? rawRating.reasons : [])
        .map((reason) => compactText(reason, 180)).filter(Boolean).slice(0, 3)),
    }),
  });
}

function normalizedPublisher(value) {
  return compactText(value, 120).normalize("NFKD").replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "");
}

function signalFromEvidence(type, signalEvidence, topic = "", language = "it") {
  if (!signalEvidence.length) return null;
  const lead = signalEvidence[0];
  if (type === "trend" && new Set(signalEvidence.map((item) => normalizedPublisher(item.source))).size < 2) return null;
  const score = Math.round(signalEvidence.reduce((total, item) => total + item.editorialRating.score, 0) / signalEvidence.length);
  const date = lead.publishedAt.slice(0, 10);
  const italian = language === "it";
  const title = type === "news"
    ? lead.title
    : italian ? `${topic}: segnale editoriale multi-fonte` : `${topic}: multi-source editorial signal`;
  return Object.freeze({
    id: `${type}-${date}-${normalizedPublisher(type === "news" ? lead.source : topic).slice(0, 48)}`,
    type,
    title,
    summary: type === "news"
      ? italian ? `Titolo riportato da ${lead.source} il ${date}.` : `Headline reported by ${lead.source} on ${date}.`
      : italian
        ? `${signalEvidence.length} editori indipendenti hanno pubblicato contenuti recenti sullo stesso tema di ricerca.`
        : `${signalEvidence.length} independent publishers recently covered the same research topic.`,
    whyNow: type === "news"
      ? italian
        ? `La data arriva dal feed RSS; rating editoriale ${lead.editorialRating.score}/100.`
        : `The date comes from the RSS feed; editorial rating ${lead.editorialRating.score}/100.`
      : italian
        ? `Le fonti RSS sono entro 14 giorni e appartengono a ${signalEvidence.length} editori distinti; non è una misura di viralità social.`
        : `The RSS sources are within 14 days and come from ${signalEvidence.length} distinct publishers; this is not a measure of social virality.`,
    angle: type === "news"
      ? italian
        ? "Separa il fatto riportato dalla tua lettura critica e verifica l’eventuale fonte primaria."
        : "Separate the reported fact from your critical take and verify any primary source."
      : italian
        ? "Confronta i diversi tagli editoriali e segnala apertamente ciò che resta incerto."
        : "Compare the different editorial angles and state clearly what remains uncertain.",
    hook: type === "news"
      ? italian ? `“${compactText(lead.title, 150)}”: cosa sappiamo davvero?` : `“${compactText(lead.title, 150)}”: what do we actually know?`
      : italian ? `${topic}: perché più testate ne stanno parlando adesso?` : `${topic}: why are multiple outlets covering it now?`,
    cta: type === "news"
      ? italian ? "Apri la fonte e chiedi quale conseguenza conta di più." : "Open the source and ask which consequence matters most."
      : italian ? "Mostra i link e chiedi quale interpretazione merita un approfondimento." : "Show the links and ask which interpretation deserves a deeper look.",
    format: type === "news" ? "carousel" : "reel",
    suggestedDay: type === "news" ? "tuesday" : "thursday",
    confidenceScore: score,
    sourceCount: signalEvidence.length,
    evidence: Object.freeze(signalEvidence),
  });
}

export function normalizeIntelSnapshot(raw, { now = new Date(), language = "it" } = {}) {
  if (!raw || !Array.isArray(raw.items)) {
    throw new Error("SNAPSHOT_INVALID");
  }
  const normalizedLanguage = normalizeIntelLanguage(language);
  const generatedAt = new Date(raw.fetchedAt || raw.generatedAt || "");
  if (!Number.isFinite(generatedAt.getTime())) throw new Error("SNAPSHOT_INVALID");
  const evidence = Object.freeze(raw.items.map((item) => normalizeEvidence(item, normalizedLanguage)).filter(Boolean)
    .sort((left, right) => Number(right.editorialRating.score) - Number(left.editorialRating.score)
      || Date.parse(right.publishedAt) - Date.parse(left.publishedAt)));
  const ageMs = now.getTime() - generatedAt.getTime();
  const stale = ageMs < -6 * 60 * 60 * 1_000 || ageMs > MAX_SNAPSHOT_AGE_MS;
  const currentNews = evidence.filter((item) => generatedAt.getTime() - Date.parse(item.publishedAt) <= 7 * 86_400_000);
  const news = signalFromEvidence("news", currentNews.slice(0, 1), "", normalizedLanguage);
  const topics = new Map();
  for (const item of evidence) {
    if (!TREND_TOPIC_IDS.has(item.topic)) continue;
    const entry = topics.get(item.topic) || { label: item.topicLabel || item.topic, items: [] };
    const list = entry.items;
    if (!list.some((candidate) => normalizedPublisher(candidate.source) === normalizedPublisher(item.source))) list.push(item);
    topics.set(item.topic, entry);
  }
  const trendGroup = [...topics.entries()].filter(([, entry]) => entry.items.length >= 2)
    .sort((left, right) => right[1].items.length - left[1].items.length
      || right[1].items.reduce((sum, item) => sum + item.editorialRating.score, 0)
        - left[1].items.reduce((sum, item) => sum + item.editorialRating.score, 0))[0] || null;
  const trend = trendGroup
    ? signalFromEvidence("trend", trendGroup[1].items.slice(0, 3), trendGroup[1].label, normalizedLanguage)
    : null;
  const italian = normalizedLanguage === "it";
  return Object.freeze({
    schemaVersion: 1,
    release: "v37",
    language: normalizedLanguage,
    generatedAt: generatedAt.toISOString(),
    source: "google-news-rss",
    costProfile: "zero-cost-static-rss",
    stale,
    news: stale ? null : news,
    trend: stale ? null : trend,
    evidence,
    incomplete: Object.freeze({
      news: stale
        ? italian ? "Snapshot scaduto: rigenerare al deploy." : "Snapshot expired: regenerate it during deployment."
        : news ? null : italian ? "Nessuna notizia gaming con prova RSS entro 7 giorni." : "No gaming news with RSS evidence from the past 7 days.",
      trend: stale
        ? italian ? "Snapshot scaduto: rigenerare al deploy." : "Snapshot expired: regenerate it during deployment."
        : trend ? null : italian ? "Nessun tema sostenuto da almeno due editori indipendenti." : "No topic supported by at least two independent publishers.",
    }),
  });
}

export async function loadIntelSnapshot({ fetchImpl = globalThis.fetch, refresh = false, signal, language = "it" } = {}) {
  if (refresh) snapshotPromise = null;
  if (snapshotPromise) return normalizeIntelSnapshot(await snapshotPromise, { language });
  const pending = (async () => {
    const response = await fetchImpl(SNAPSHOT_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response?.ok) throw new Error(`SNAPSHOT_FETCH_${response?.status || "FAILED"}`);
    return response.json();
  })();
  snapshotPromise = pending;
  try {
    return normalizeIntelSnapshot(await pending, { language });
  } catch (error) {
    if (snapshotPromise === pending) snapshotPromise = null;
    throw error;
  }
}

export function resetIntelSnapshotCacheForTests() {
  snapshotPromise = null;
}
