const NEWS_RECOMMENDATIONS = new Set(["cover", "monitor", "skip"]);

function compactText(value, maxChars = 500) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  return text.length <= maxChars
    ? text
    : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function localDateKey(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function displayDate(date, timeZone) {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function briefingEvidence(briefing) {
  const evidence = Array.isArray(briefing?.metadata?.evidence)
    ? briefing.metadata.evidence
    : [];
  const leadId = Array.isArray(briefing?.itemIds) ? briefing.itemIds[0] : null;
  return evidence.find((item) => leadId && item?.id === leadId)
    || evidence.find((item) => compactText(item?.title) === compactText(briefing?.title))
    || evidence[0]
    || null;
}

function normalizedTier(value) {
  const tier = String(value || "").toLowerCase();
  if (["aggregator", "google-news-rss"].includes(tier)) return "aggregator";
  if (["official", "official-primary"].includes(tier)) return "official-primary";
  if (tier === "evergreen") return "evergreen";
  return "unknown";
}

function evidenceTier(evidence, metadata, url) {
  const source = compactText(evidence?.source, 120).toLocaleLowerCase("it");
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLocaleLowerCase("en");
  } catch {
    // The URL has already been rejected; classification falls back to metadata.
  }
  if (hostname === "news.google.com" || source.includes("google news")) {
    return "aggregator";
  }
  return normalizedTier(evidence?.sourceTier || metadata?.sourceTier);
}

/**
 * Produces the complete transcript reply for a current-news turn without an
 * unconstrained completion. Every story detail is copied from structured
 * briefing evidence and is explicitly attributed to that source.
 */
export function buildGroundedNewsReply(
  briefing,
  { now = new Date(), timeZone = "Europe/Rome" } = {},
) {
  if (!briefing) {
    return {
      reply: "Miura, non ho ancora un briefing di fonti acquisito. Non ti invento una notizia: avvia Daily Intel e poi ti riporto soltanto ciò che contiene.",
      briefingId: null,
      sourceTier: "none",
      claimStatus: "unavailable",
      recommendation: "scan",
      evidenceUrl: "",
      stale: false,
    };
  }

  const metadata = briefing.metadata || {};
  const createdAt = new Date(briefing.created_at || metadata.scannedAt || "");
  const validCreatedAt = Number.isFinite(createdAt.getTime());
  const stale = validCreatedAt
    ? localDateKey(createdAt, timeZone) !== localDateKey(now, timeZone)
    : true;
  const scanLabel = validCreatedAt
    ? `Il briefing più recente è del ${displayDate(createdAt, timeZone)}`
    : "Il briefing più recente non ha una data verificabile";

  if (String(metadata.contentType || "news") === "evergreen") {
    const title = compactText(briefing.title, 300);
    return {
      reply: `${scanLabel}: non conteneva una notizia abbastanza solida. La proposta “${title}” è un evergreen, non una notizia corrente.`,
      briefingId: briefing.id,
      sourceTier: "evergreen",
      claimStatus: "evergreen",
      recommendation: "cover",
      evidenceUrl: "",
      stale,
    };
  }

  const evidence = briefingEvidence(briefing);
  if (!evidence) {
    return {
      reply: `${scanLabel}, ma non contiene una prova strutturata utilizzabile. Non tratto il suo titolo come un fatto: serve una nuova scansione di Daily Intel.`,
      briefingId: briefing.id,
      sourceTier: "unknown",
      claimStatus: "unverified",
      recommendation: "scan",
      evidenceUrl: "",
      stale,
    };
  }

  const title = compactText(evidence.title, 300);
  const source = compactText(evidence.source || "Fonte non identificata", 120);
  const url = safeHttpUrl(evidence.url);
  const sourceTier = evidenceTier(evidence, metadata, url);
  const storedRecommendation = NEWS_RECOMMENDATIONS.has(evidence.recommendation)
    ? evidence.recommendation
    : NEWS_RECOMMENDATIONS.has(metadata.recommendation)
      ? metadata.recommendation
      : "monitor";

  let statusSentence;
  let claimStatus;
  let recommendation;
  if (sourceTier === "official-primary") {
    claimStatus = "confirmed";
    recommendation = storedRecommendation;
    statusSentence = `È confermata soltanto come dichiarazione diretta della fonte ufficiale; raccomandazione: ${recommendation === "cover" ? "coprire" : "monitorare"}.`;
  } else if (sourceTier === "aggregator") {
    claimStatus = "unconfirmed";
    recommendation = "monitor";
    statusSentence = "È una segnalazione da aggregatore, non confermata: va monitorata e verificata su una fonte primaria prima di usarla come notizia.";
  } else {
    claimStatus = "unverified";
    recommendation = "skip";
    statusSentence = "La provenienza non è verificata: non la userei come notizia finché non troviamo una fonte primaria.";
  }

  const freshnessSentence = stale
    ? `${scanLabel}, quindi non la presento come notizia di oggi.`
    : `${scanLabel}.`;
  const urlSentence = url ? `Fonte: ${source}. URL: ${url}` : `Fonte: ${source}; URL non disponibile.`;
  return {
    reply: `${freshnessSentence} Il titolo registrato dalla fonte è “${title}”. ${statusSentence} ${urlSentence}`,
    briefingId: briefing.id,
    sourceTier,
    claimStatus,
    recommendation,
    evidenceUrl: url,
    stale,
  };
}
