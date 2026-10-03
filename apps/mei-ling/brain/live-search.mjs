import { fetchFeed } from "./rss.mjs";
import { buildGoogleNewsRssUrl } from "./source-catalog.mjs";

const DEFAULT_TIME_ZONE = "Europe/Rome";
const MAX_QUERY_CHARS = 120;
const MAX_QUERY_TOKENS = 14;
const MAX_RESULTS = 3;
const GLOBAL_NEWS_EDITIONS = Object.freeze([
  { id: "it", language: "it", region: "IT", edition: "IT:it" },
  { id: "en-us", language: "en-US", region: "US", edition: "US:en" },
  { id: "en-gb", language: "en-GB", region: "GB", edition: "GB:en" },
  { id: "ja", language: "ja", region: "JP", edition: "JP:ja" },
  { id: "es", language: "es", region: "ES", edition: "ES:es" },
  { id: "fr", language: "fr", region: "FR", edition: "FR:fr" },
  { id: "de", language: "de", region: "DE", edition: "DE:de" },
  { id: "pt-br", language: "pt-BR", region: "BR", edition: "BR:pt-419" },
]);
const GENERIC_GAMING_TOPIC = /^(?:gaming|game|games|giochi|videogiochi|video\s*games?)$/iu;
const GAMING_SIGNAL = /\b(?:videogioch\w*|video\s*games?|videojuegos|jeux\s*vid[eé]o|videospiele|computerspiele|gaming|playstation|ps[345]|xbox|nintendo|switch|steam|gamepass|game\s*pass|fromsoftware|kojima|rpg|jrpg|crpg|arpg|soulslike|indie\s*game|pc\s*gaming|console|dlc|gameplay|remake|remaster|early\s*access|gamescom|tokyo\s*game\s*show|the\s*game\s*awards)\b|ゲーム業界|ビデオゲーム|コンピュータゲーム|ゲームソフト|ゲーム開発|ゲーム会社|ゲーム機|eスポーツ|비디오\s*게임|게임\s*산업/iu;
const GAMBLING_SIGNAL = /\b(?:gambling|betting|bet|bets|casino|casino|casinò|scommess\w*|lotteri\w*|lotto|lotteria|jackpot|poker|slot\s*machine|sportsbook|lottomatica|snai|superenalotto|bingo)\b/iu;
const GAMING_EDITORIAL_PUBLISHER = /\b(?:ign|gamespot|pc\s*gamer|eurogamer|rock\s*paper\s*shotgun|polygon|video\s*games\s*chronicle|vgc|game\s*informer|kotaku|gamesindustry(?:\.biz)?|digital\s*foundry|nintendo\s*life|push\s*square|pure\s*xbox|rpg\s*site|multiplayer(?:\.it)?|everyeye|spaziogames|tom'?s\s*hardware|gamereactor|famitsu|4gamer|game\s*watch|dengeki|inside\s*games|vandal|meristation|3djuegos|hobby\s*consolas|levelup|jeuxvideo|gamekult|gameblog|actugaming|gamestar|pc\s*games|gameswirtschaft|adrenaline|the\s*enemy|meuplaystation|videogioch\w*|gaming|gamer|playstation|xbox|nintendo|steam|capcom|square\s*enix|bandai\s*namco|sega|ubisoft|bethesda|blizzard|devolver|fromsoftware|kojima\s*productions)\b|ファミ通|電撃オンライン|インサイド/iu;
const EDITORIAL_RATING_MODEL = "topic-freshness-source-v1";
const EDITORIAL_RATING_WEIGHTS = Object.freeze({
  topicRelevance: 0.5,
  freshness: 0.3,
  sourceTraceability: 0.2,
});
const EDITORIAL_RATING_STOP_WORDS = new Set([
  "a",
  "ad",
  "al",
  "alla",
  "and",
  "con",
  "da",
  "dal",
  "dalla",
  "de",
  "dei",
  "del",
  "della",
  "di",
  "e",
  "ed",
  "for",
  "gli",
  "i",
  "il",
  "in",
  "l",
  "la",
  "le",
  "lo",
  "nel",
  "nella",
  "of",
  "per",
  "su",
  "the",
  "un",
  "una",
]);

function normalizeIntentText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("it")
    .replace(/[’']/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function compactText(value, maxChars = 500) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  return text.length <= maxChars
    ? text
    : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function publicHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function dateTimeLabel(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "data non disponibile";
  return new Intl.DateTimeFormat("it-IT", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
function editorialRatingTokenSequence(value) {
  return normalizeIntentText(value)
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token && !EDITORIAL_RATING_STOP_WORDS.has(token));
}

function topicRelevanceComponent(title, topic) {
  if (GENERIC_GAMING_TOPIC.test(String(topic || "").trim()) && GAMING_SIGNAL.test(String(title || ""))) {
    return {
      score: 100,
      weight: EDITORIAL_RATING_WEIGHTS.topicRelevance,
      matchedTokens: 1,
      totalTokens: 1,
      exactPhrase: false,
      reason: "Titolo: segnale editoriale gaming esplicito nella lingua della fonte.",
    };
  }
  const topicSequence = editorialRatingTokenSequence(topic);
  const titleSequence = editorialRatingTokenSequence(title);
  const topicTokens = [...new Set(topicSequence)];
  const titleTokens = new Set(titleSequence);
  const matchedTokens = topicTokens.filter((token) => titleTokens.has(token));
  if (!topicTokens.length) {
    return {
      score: 0,
      weight: EDITORIAL_RATING_WEIGHTS.topicRelevance,
      matchedTokens: 0,
      totalTokens: 0,
      exactPhrase: false,
      reason: "Titolo: il tema non contiene parole utili per una valutazione.",
    };
  }

  const exactPhrase = titleSequence.join(" ").includes(topicSequence.join(" "));
  const coverage = matchedTokens.length / topicTokens.length;
  const score = Math.min(100, Math.round(coverage * 85 + (exactPhrase ? 15 : 0)));
  return {
    score,
    weight: EDITORIAL_RATING_WEIGHTS.topicRelevance,
    matchedTokens: matchedTokens.length,
    totalTokens: topicTokens.length,
    exactPhrase,
    reason: exactPhrase
      ? `Titolo: frase esatta e ${matchedTokens.length}/${topicTokens.length} parole del tema.`
      : `Titolo: ${matchedTokens.length}/${topicTokens.length} parole del tema.`,
  };
}

function freshnessComponent(publishedAt, fetchedAt) {
  const publishedTime = Date.parse(publishedAt || "");
  const fetchedTime = Date.parse(fetchedAt || "");
  const base = {
    score: 0,
    weight: EDITORIAL_RATING_WEIGHTS.freshness,
    ageHours: null,
    basis: "feed-reported-date",
  };
  if (!Number.isFinite(publishedTime) || !Number.isFinite(fetchedTime)) {
    return {
      ...base,
      reason: "Attualità: data non disponibile nel feed; nessun punto assegnato alla freschezza.",
    };
  }

  const rawAgeHours = (fetchedTime - publishedTime) / (60 * 60 * 1_000);
  const ageHours = Number(rawAgeHours.toFixed(2));
  if (rawAgeHours < -6) {
    return {
      ...base,
      ageHours,
      anomaly: "future-date",
      reason: "Attualità: data del feed anomala, oltre 6 ore nel futuro; nessun punto assegnato.",
    };
  }

  const comparableAge = Math.max(0, rawAgeHours);
  let score = 0;
  if (comparableAge <= 24) score = 100;
  else if (comparableAge <= 72) score = 85;
  else if (comparableAge <= 7 * 24) score = 70;
  else if (comparableAge <= 30 * 24) score = 50;
  else if (comparableAge <= 90 * 24) score = 20;
  return {
    ...base,
    score,
    ageHours,
    reason: `Attualità: data riportata dal feed ${Math.max(0, ageHours)} ore fa.`,
  };
}

function sourceTraceabilityComponent(sourceTier) {
  const normalizedTier = String(sourceTier || "unknown").trim().toLowerCase();
  if (["official", "official-primary"].includes(normalizedTier)) {
    return {
      score: 100,
      weight: EDITORIAL_RATING_WEIGHTS.sourceTraceability,
      tier: "official-primary",
      reason: "Fonte: canale ufficiale o primario, con attribuzione diretta.",
    };
  }
  if (["aggregator", "google-news-rss"].includes(normalizedTier)) {
    return {
      score: 40,
      weight: EDITORIAL_RATING_WEIGHTS.sourceTraceability,
      tier: "aggregator",
      reason: "Fonte: Google News è un aggregatore; verifica necessaria sulla fonte primaria.",
    };
  }
  return {
    score: 10,
    weight: EDITORIAL_RATING_WEIGHTS.sourceTraceability,
    tier: "unknown",
    reason: "Fonte: provenienza non verificata; serve una fonte primaria.",
  };
}

function editorialRatingLabel(score) {
  if (score >= 80) return "ALTO";
  if (score >= 60) return "BUONO";
  if (score >= 40) return "MEDIO";
  return "BASSO";
}

export function buildEditorialRating(
  item,
  { topic = "", fetchedAt = new Date().toISOString(), sourceTier = "aggregator" } = {},
) {
  const topicRelevance = topicRelevanceComponent(item?.title, topic);
  const freshness = freshnessComponent(item?.publishedAt, fetchedAt);
  const sourceTraceability = sourceTraceabilityComponent(
    item?.sourceTier || sourceTier,
  );
  const score = Math.round(
    topicRelevance.score * topicRelevance.weight
      + freshness.score * freshness.weight
      + sourceTraceability.score * sourceTraceability.weight,
  );
  return {
    score,
    label: editorialRatingLabel(score),
    model: EDITORIAL_RATING_MODEL,
    components: {
      topicRelevance,
      freshness,
      sourceTraceability,
    },
    reasons: [
      topicRelevance.reason,
      freshness.reason,
      sourceTraceability.reason,
    ],
    verificationRequired: sourceTraceability.tier !== "official-primary",
  };
}

export function asksInternetCapability(message) {
  const text = normalizeIntentText(message);
  return [
    /\b(?:sei|risulti) (?:connessa|collegata)(?: (?:a|ad))? (?:internet|web)\b/u,
    /\b(?:hai|avete) (?:accesso (?:a|ad|al|alla) )?(?:internet|web|rete)\b/u,
    /\b(?:puoi|riesci a) (?:accedere|collegarti|andare|cercare) (?:su |a |ad )?(?:internet|web|online)\s*\??$/u,
    /\b(?:internet|ricerca web) (?:funziona|e attiv[ao]|e disponibile)\b/u,
    /\bvoi connest[ia] da internet\b/u,
  ].some((pattern) => pattern.test(text));
}

export function requestsLiveSearch(message) {
  if (asksInternetCapability(message)) return false;
  const text = normalizeIntentText(message);
  const explicitCerca = /\bcerca\b/u.test(text)
    && (!/\bcerca di\b/u.test(text)
      || /\bcerca di\b[\s\S]{0,100}\b(?:online|internet|web|notizia|news|annuncio|fonte|fonti|uscita)\b/u.test(text));
  const explicitSearch = /\b(?:cercami|trova|ricerca|fact check|cerca online|cerca sul web)\b/u.test(text)
    || explicitCerca
    || /\b(?:verifica|controlla)\b[\s\S]{0,80}\b(?:online|internet|web|notizia|news|annuncio|fonte|fonti|uscita)\b/u.test(text);
  const currentIntel = /\b(?:notizie|news|novita|aggiornamenti|ultime|ultimo annuncio|cosa c\W?e di nuovo|cosa succede oggi|annunci recenti|appena annunciato)\b/u.test(text);
  const releaseOrStatus = /\b(?:quando (?:esce|e uscito|e gia uscito|uscira)|data di uscita|deve ancora uscire|deve uscire|e gia uscito|e uscito|non e ancora uscito|stato attuale|e vero che)\b/u.test(text);
  const hasNamedSubject = /(?:^|[.!?]\s+)(?:[^.!?]*\s)?\p{Lu}[\p{L}0-9"-]+(?:\s+\p{Lu}[\p{L}0-9"-]+){1,5}/u.test(String(message || ""));
  const temporalStatus = /\b(?:ancora in sviluppo|in sviluppo|e disponibile|disponibilita)\b/u.test(text)
    && (String(message || "").includes("?") || hasNamedSubject);
  const sourceRequest = /\b(?:fonte|fonti)\b/u.test(text)
    && /\b(?:trova|cerca|verifica|qual e|quali sono|dammi|mostrami)\b/u.test(text);
  return explicitSearch || currentIntel || releaseOrStatus || temporalStatus || sourceRequest;
}

const SEARCH_COMMANDS = [
  /^\s*(?:ciao|salve|ehi|hey|ok|okay|allora)\b[,:;.!?\s-]*/giu,
  /\b(?:mei ling|meiling|mailing)\b/giu,
  /\b(?:hai sbagliato|ti sbagli|correggiti|correggi(?: questa risposta)?|ricominciamo da zero|non e aggiornato|non sei aggiornata)\b/giu,
  /\bqual e (?:lo |la |il )?stato attuale (?:di )?/giu,
  /\b(?:cosa|che) c\W?e di nuovo(?: su)?\b/giu,
  /\bche (?:novita|notizie|aggiornamenti) ci sono(?: su)?\b/giu,
  /\b(?:quali sono|qual e|cosa c\W?e|dimmi se)\b/giu,
  /\b(?:per favore|please)\b/giu,
  /\b(?:mi\s+)?(?:dai|daresti|potresti dare)\b/giu,
  /\b(?:cerca|cercare|cercami|trova|ricerca|verifica|controlla|fact check)\b/giu,
  /\b(?:online|su internet|sul web|nel web)\b/giu,
  /\b(?:le |gli |i |la |l'|un |una )?(?:ultime|ultimi|ultimissime|recenti)?\s*(?:notizie|news|novita|aggiornamenti)\b/giu,
  /\b(?:e\s+)?(?:dammi\s+|mostrami\s+)?(?:le\s+)?fonti\b/giu,
  /\b(?:di oggi|oggi|adesso|attualmente|al momento|piu recenti)\b/giu,
  /\b(?:dimmi|dammi|mostrami|voglio sapere|puoi)\b/giu,
  /\b(?:quando (?:esce|e uscito|e gia uscito|uscira)|qual e la data di uscita|data di uscita|deve ancora uscire|deve uscire|e gia uscito|e uscito|non e ancora uscito|(?:e )?ancora in sviluppo|(?:e )?in sviluppo|e disponibile|disponibilita|stato attuale|e vero che)\b/giu,
  /\b(?:su|riguardo a|riguardo|about|per)\b/giu,
];

export function extractSearchTopic(message) {
  let topic = String(message || "")
    .replace(/^\s*(?:no|sbagliato)[,!:;]+\s*/iu, "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/https?:\/\/\S+|www\.\S+/giu, " ")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, " ")
    .replace(/\b\d{5,}\b/gu, " ");
  for (const pattern of SEARCH_COMMANDS) topic = topic.replace(pattern, " ");
  topic = topic
    .replace(/[^\p{L}\p{N}+#.'-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^(?:e|ed|ma|quindi)\s+/iu, "")
    .replace(/^[,.:;!?-]+|[,.:;!?-]+$/gu, "");
  const tokens = topic.split(" ").filter(Boolean).slice(0, MAX_QUERY_TOKENS);
  const bounded = compactText(tokens.join(" "), MAX_QUERY_CHARS);
  if (!bounded || GENERIC_GAMING_TOPIC.test(bounded)) return "videogiochi";
  return bounded;
}

function queryWithFreshness(message, topic) {
  const text = normalizeIntentText(message);
  const asksLatest = /\b(?:notizie|news|novita|aggiornamenti|ultime|oggi|recente|appena annunciato)\b/u.test(text);
  if (GENERIC_GAMING_TOPIC.test(topic)) {
    const freshness = asksLatest ? " when:7d" : " when:30d";
    return '("video games" OR videogiochi OR videojuegos OR "jeux vidéo" OR Computerspiele OR ゲーム業界 OR ビデオゲーム OR 비디오게임)'
      + freshness
      + " -gambling -betting -casino -scommesse -lotteria -poker";
  }
  return asksLatest ? `${topic} when:30d` : topic;
}

function splitGoogleNewsTitle(value) {
  const title = compactText(value, 360);
  const separator = title.lastIndexOf(" - ");
  if (separator < 1 || separator >= title.length - 3) {
    return { title, reportedPublisher: "editore non indicato" };
  }
  return {
    title: title.slice(0, separator).trim(),
    reportedPublisher: title.slice(separator + 3).trim(),
  };
}

function normalizeResult(item, edition) {
  const split = splitGoogleNewsTitle(item?.title);
  return {
    title: split.title,
    source: split.reportedPublisher,
    aggregator: "Google News",
    url: publicHttpUrl(item?.canonicalUrl || item?.url),
    publishedAt: item?.published || item?.updated || null,
    sourceTier: "aggregator",
    claimStatus: "unconfirmed",
    language: edition.language,
    edition: edition.id,
  };
}

export function isGamingEditorialResult(item, topic = "videogiochi") {
  const haystack = `${item?.title || ""} ${item?.source || ""} ${item?.summary || ""}`;
  if (GAMBLING_SIGNAL.test(haystack)) return false;
  if (!GAMING_EDITORIAL_PUBLISHER.test(String(item?.source || ""))) return false;
  if (GENERIC_GAMING_TOPIC.test(topic)) return GAMING_SIGNAL.test(haystack);
  const topicTokens = normalizeIntentText(topic)
    .split(/\s+/u)
    .filter((token) => token.length >= 4);
  const normalizedHaystack = normalizeIntentText(haystack);
  return topicTokens.some((token) => normalizedHaystack.includes(token));
}

export async function searchLivePublicNews(
  message,
  {
    enabled = true,
    clock = () => new Date(),
    fetchFeedImpl = fetchFeed,
    timeoutMs = 12_000,
  } = {},
) {
  const fetchedAt = clock().toISOString();
  const topic = extractSearchTopic(message);
  if (!enabled) {
    return {
      ok: false,
      status: "disabled",
      query: topic,
      fetchedAt,
      results: [],
      errorCode: "LIVE_SEARCH_DISABLED",
    };
  }

  const googleQuery = queryWithFreshness(message, topic);
  const sources = GLOBAL_NEWS_EDITIONS.map((edition) => {
    const url = buildGoogleNewsRssUrl(googleQuery, edition);
    return {
      edition,
      url,
      source: {
        id: `mei-live-google-news-${edition.id}`,
        name: `Google News — ricerca gaming ${edition.id}`,
        kind: "google-news-rss",
        publisherType: "aggregator",
        url,
      },
    };
  });
  try {
    const settled = await Promise.allSettled(sources.map(({ source, url }) => fetchFeedImpl(
      source,
      {
        timeoutMs,
        allowedUrls: new Set([url]),
        allowUncatalogued: true,
        maxDescriptionChars: 600,
      },
    )));
    const successfulFeeds = settled
      .map((result, index) => ({ result, edition: sources[index].edition }))
      .filter(({ result }) => result.status === "fulfilled");
    if (!successfulFeeds.length) {
      const failure = settled.find((result) => result.status === "rejected");
      throw failure?.reason || new Error("No global gaming feed was reachable");
    }
    const seen = new Set();
    const rankedResults = successfulFeeds
      .flatMap(({ result, edition }) => (result.value?.feed?.items || []).map((item) => normalizeResult(item, edition)))
      .filter((item) => isGamingEditorialResult(item, topic))
      .filter((item) => {
        const key = `${normalizeIntentText(item.title)}|${item.url}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((item) => ({
        ...item,
        editorialRating: buildEditorialRating(item, {
          topic,
          fetchedAt,
          sourceTier: "aggregator",
        }),
      }))
      .filter((item) => item.title && item.url)
      .sort((left, right) => {
        const ratingDelta = Number(right.editorialRating?.score || 0)
          - Number(left.editorialRating?.score || 0);
        if (ratingDelta) return ratingDelta;
        return Date.parse(right.publishedAt || 0) - Date.parse(left.publishedAt || 0);
      });
    const usedLanguages = new Set();
    const diverseResults = [];
    for (const item of rankedResults) {
      const baseLanguage = String(item.language || "unknown").toLowerCase().split("-")[0];
      if (usedLanguages.has(baseLanguage)) continue;
      diverseResults.push(item);
      usedLanguages.add(baseLanguage);
      if (diverseResults.length === MAX_RESULTS) break;
    }
    if (diverseResults.length < MAX_RESULTS) {
      for (const item of rankedResults) {
        if (diverseResults.includes(item)) continue;
        diverseResults.push(item);
        if (diverseResults.length === MAX_RESULTS) break;
      }
    }
    const results = diverseResults;
    return {
      ok: true,
      status: results.length ? "results" : "empty",
      query: topic,
      fetchedAt,
      source: "Google News",
      sourceUrl: sources[0].url,
      searchedEditions: successfulFeeds.map(({ edition }) => edition.id),
      sourceTier: "aggregator",
      claimStatus: "unconfirmed",
      results,
    };
  } catch (error) {
    return {
      ok: false,
      status: "unreachable",
      query: topic,
      fetchedAt,
      results: [],
      errorCode: String(error?.code || "LIVE_SEARCH_UNREACHABLE"),
    };
  }
}

export function buildLiveSearchReply(
  search,
  { timeZone = DEFAULT_TIME_ZONE } = {},
) {
  const fetchedLabel = dateTimeLabel(search?.fetchedAt, timeZone);
  if (search?.status === "disabled") {
    return "Miura, la ricerca Internet in sola lettura non è attiva in questa esecuzione. Non userò la memoria del modello come se fosse una fonte aggiornata.";
  }
  if (!search?.ok) {
    return `Miura, ho provato la ricerca web in sola lettura alle ${fetchedLabel}, ma la fonte pubblica non è raggiungibile. Non ti do una risposta dalla memoria del modello perché potrebbe essere vecchia.`;
  }
  if (!search.results?.length) {
    return `Ricerca web in sola lettura eseguita alle ${fetchedLabel} per “${compactText(search.query, MAX_QUERY_CHARS)}”. Google News non ha restituito risultati utilizzabili; non invento una risposta.`;
  }
  const lines = search.results.map((item, index) => {
    const published = dateTimeLabel(item.publishedAt, timeZone);
    const rating = item.editorialRating;
    const ratingText = Number.isFinite(Number(rating?.score))
      ? `rating editoriale: ${rating.score}/100 (${rating.label})`
      : "rating editoriale non disponibile";
    return `${index + 1}. “${compactText(item.title, 300)}” — ${ratingText} — fonte segnalata: ${compactText(item.source, 100)} — data riportata dal feed: ${published} — URL: ${item.url}`;
  });
  return [
    `Ricerca web in sola lettura eseguita alle ${fetchedLabel} per “${compactText(search.query, MAX_QUERY_CHARS)}”.`,
    "Google News è un aggregatore: i risultati seguenti sono segnalazioni non confermate, da verificare su una fonte primaria.",
    ...lines,
  ].join("\n");
}

export function buildLiveSearchSpokenReply(
  search,
  { timeZone = DEFAULT_TIME_ZONE } = {},
) {
  if (!search?.ok || !search.results?.length) {
    return buildLiveSearchReply(search, { timeZone });
  }
  const first = search.results[0];
  const published = dateTimeLabel(first.publishedAt, timeZone);
  const rating = Number(first.editorialRating?.score);
  const ratingSentence = Number.isFinite(rating)
    ? ` Ha un rating editoriale di ${rating} su 100.`
    : "";
  return `Miura, ricerca web aggiornata: il primo risultato è “${compactText(first.title, 260)}”, fonte segnalata ${compactText(first.source, 100)}, con data riportata dal feed ${published}.${ratingSentence} È una segnalazione non confermata da aggregatore; trovi tutti i link sullo schermo.`;
}

export function buildInternetCapabilityReply(
  probe,
  { schedulerEnabled = true, timeZone = DEFAULT_TIME_ZONE } = {},
) {
  const fetchedLabel = dateTimeLabel(probe?.fetchedAt, timeZone);
  const scheduler = schedulerEnabled
    ? "Il Daily Intel automatico è attivo"
    : "Il Daily Intel automatico è disattivato in questa esecuzione";
  if (probe?.status === "disabled") {
    return `No, Miura: la ricerca web live è disattivata. ${scheduler}.`;
  }
  if (!probe?.ok) {
    return `La ricerca web è configurata, ma alle ${fetchedLabel} non sono riuscita a raggiungere Google News; quindi adesso non posso dichiararmi connessa. ${scheduler}.`;
  }
  return `Sì, Miura: alle ${fetchedLabel} ho raggiunto Google News in sola lettura. La ricerca su richiesta è attiva. ${scheduler}; per i fatti correnti consulto il web, non la memoria del modello.`;
}
