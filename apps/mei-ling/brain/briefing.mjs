import { MIURA_RELEVANCE_PROFILE } from "./source-catalog.mjs";

function words(value) {
  return String(value || "").trim().split(/\s+/u).filter(Boolean);
}

function clampScore(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizedScore(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return clampScore(numeric <= 1 ? numeric * 100 : numeric, fallback);
}

export function clampSpokenSummary(value, maxWords = 32) {
  const compact = String(value || "")
    .replace(/[*_#`>]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const parts = words(compact);
  if (parts.length <= maxWords) return compact;
  return `${parts.slice(0, maxWords).join(" ").replace(/[,:;.!?…]+$/u, "")}…`;
}

function parseModelJson(value) {
  const raw = String(value || "")
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Briefing model did not return JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

function sourceKind(item) {
  return String(
    item.sourceKind ||
      item.publisherType ||
      item.metadata?.sourceKind ||
      item.metadata?.publisherType ||
      "unknown",
  ).toLowerCase();
}

function timelinessScore(published, now) {
  const timestamp = Date.parse(published || "");
  if (!Number.isFinite(timestamp)) return 35;
  const ageHours = Math.max(0, now.getTime() - timestamp) / (60 * 60 * 1_000);
  if (ageHours <= 24) return 94;
  if (ageHours <= 72) return 78;
  if (ageHours <= 7 * 24) return 62;
  return 28;
}

function assessmentForTier(sourceTier) {
  if (sourceTier === "official-primary") {
    return "Fonte ufficiale o primaria: può confermare ciò che dichiara direttamente.";
  }
  if (sourceTier === "aggregator") {
    return "Aggregatore utile per scoprire la storia, ma non sufficiente per confermarla.";
  }
  return "Provenienza non verificata: serve una fonte primaria prima di usarla come notizia.";
}

export function evaluateNewsEvidence(item, now = new Date()) {
  const kind = sourceKind(item);
  const sourceTier = kind === "official"
    ? "official-primary"
    : kind === "aggregator" || kind === "google-news-rss"
      ? "aggregator"
      : "unknown";
  const claimStatus = sourceTier === "official-primary" ? "confirmed" : "reported";
  const rawConfidence = normalizedScore(
    item.confidence,
    sourceTier === "official-primary" ? 94 : 58,
  );
  const confidenceScore = sourceTier === "official-primary"
    ? Math.max(78, rawConfidence)
    : sourceTier === "aggregator"
      ? Math.min(64, rawConfidence)
      : Math.min(42, rawConfidence);
  const channelFitScore = normalizedScore(
    item.relevanceScore ?? item.relevance ?? item.score,
    50,
  );
  const freshness = timelinessScore(
    item.published || item.published_at || item.updated || item.updated_at,
    now,
  );
  let opportunityScore = clampScore(
    confidenceScore * 0.35 + channelFitScore * 0.4 + freshness * 0.25,
  );
  if (sourceTier === "aggregator") opportunityScore = Math.min(69, opportunityScore);
  if (sourceTier === "unknown") opportunityScore = Math.min(44, opportunityScore);

  let recommendation = "monitor";
  if (
    sourceTier === "unknown" ||
    confidenceScore < 45 ||
    channelFitScore < 35 ||
    freshness < 35 ||
    opportunityScore < 45
  ) {
    recommendation = "skip";
  } else if (
    sourceTier === "official-primary" &&
    confidenceScore >= 75 &&
    channelFitScore >= 55 &&
    opportunityScore >= 65
  ) {
    recommendation = "cover";
  }

  const source = String(
    item.sourceName || item.sourceId || item.source_id || "Fonte",
  );
  const whyItMatters = recommendation === "cover"
    ? "È verificabile, recente e coerente con i temi gaming che interessano al canale di Miura."
    : recommendation === "monitor"
      ? "È coerente con il canale, ma la segnalazione richiede ancora una fonte primaria."
      : "La qualità della fonte, la freschezza o l'affinità col canale non giustificano un contenuto.";

  return {
    id: item.id,
    title: String(item.title || "").slice(0, 300),
    summary: String(item.summary || "").slice(0, 700),
    source,
    url: String(item.canonicalUrl || item.url || ""),
    published: item.published || item.published_at || item.updated || item.updated_at || null,
    relevanceScore: channelFitScore,
    sourceAssessment: assessmentForTier(sourceTier),
    sourceTier,
    claimStatus,
    confidenceScore,
    channelFitScore,
    timelinessScore: freshness,
    opportunityScore,
    whyItMatters,
    recommendation,
  };
}

function normalizedEvidence(items, now) {
  return items.slice(0, 8).map((item) => evaluateNewsEvidence(item, now));
}

function shortTitle(value, maxWords = 12) {
  return words(value).slice(0, maxWords).join(" ");
}

function deterministicNewsCopy(lead) {
  const status = lead.claimStatus === "confirmed" ? "conferma" : "riporta";
  const claimLabel = lead.claimStatus === "confirmed"
    ? "confermata"
    : "non confermata";
  const recommendation = lead.recommendation === "cover"
    ? "coprila oggi"
    : "monitorala e aspetta una fonte primaria";
  return {
    headline: lead.title,
    spokenSummary: clampSpokenSummary(
      `Miura, ${lead.source} ${status} “${shortTitle(lead.title)}”. Stato: ${claimLabel}; confidenza ${lead.confidenceScore} su 100. La mia raccomandazione: ${recommendation}.`,
    ),
    creatorAngle: lead.recommendation === "cover"
      ? "Spiega perché questa notizia conta per il tuo pubblico, separando il fatto confermato dalla tua lettura critica."
      : "Confronta la segnalazione con una fonte primaria prima di trasformarla in una tesi.",
    recordingMission: lead.recommendation === "cover"
      ? "Registra una reazione di 60–90 secondi con fatto, opinione e domanda finale."
      : "Monitora la storia e prepara tre domande da verificare prima di registrare.",
  };
}

const EVERGREEN_IDEAS = Object.freeze([
  {
    profileId: "kojima-auteur",
    topic: "il Codec di Metal Gear come strumento narrativo, non semplice menu",
    angle: "Analizza come una conversazione possa costruire personaggi, tensione e mondo senza interrompere il coinvolgimento.",
  },
  {
    profileId: "fromsoftware-souls",
    topic: "quando la difficoltà di un soulslike comunica davvero qualcosa",
    angle: "Difendi la differenza tra difficoltà significativa, attrito inutile e soddisfazione costruita dal giocatore.",
  },
  {
    profileId: "final-fantasy-rpg",
    topic: "cosa dovrebbe preservare davvero un remake di Final Fantasy",
    angle: "Confronta fedeltà emotiva, sistemi modernizzati e scelte che cambiano l'identità dell'originale.",
  },
  {
    profileId: "indie-experimental",
    topic: "perché giochi come The Binding of Isaac, Kenshi e Dwarf Fortress generano storie personali",
    angle: "Spiega come sistemi, fallimenti e imprevisti possano creare ricordi più forti di una trama prescritta.",
  },
  {
    profileId: "horror",
    topic: "la differenza tra paura, disagio e mistero nell'horror psicologico",
    angle: "Confronta Silent Hill, Alan Wake e gli horror più sperimentali attraverso le emozioni che cercano di provocare.",
  },
  {
    profileId: "strategy-simulation",
    topic: "perché si può amare Stellaris o Crusader Kings anche senza essere esperti",
    angle: "Racconta il valore della scoperta, degli errori e delle storie emergenti oltre la padronanza tecnica.",
  },
  {
    profileId: "coop-action",
    topic: "quando un gioco cooperativo funziona anche per chi finisce spesso a giocare da solo",
    angle: "Metti a confronto libertà, dipendenza dal gruppo e qualità dell'avventura individuale.",
  },
  {
    profileId: "creator-industry",
    topic: "come trasformare una passione gaming molto ampia in una rubrica riconoscibile",
    angle: "Trasforma tre gusti apparentemente lontani in un format ricorrente con una tesi personale chiara.",
  },
]);

function dayHash(date) {
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`
    .split("")
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);
}

export function buildEvergreenBriefing(now = new Date()) {
  const availableProfileIds = new Set(
    MIURA_RELEVANCE_PROFILE.map((entry) => entry.id),
  );
  const ideas = EVERGREEN_IDEAS.filter((entry) => availableProfileIds.has(entry.profileId));
  const idea = ideas[dayHash(now) % ideas.length];
  const profile = MIURA_RELEVANCE_PROFILE.find((entry) => entry.id === idea.profileId);
  const headline = `Evergreen: ${idea.topic}`;
  return {
    contentType: "evergreen",
    headline,
    spokenSummary: clampSpokenSummary(
      `Miura, oggi non ho una notizia abbastanza solida. Ti propongo un evergreen su ${idea.topic}. Stato evergreen, raccomandazione: coprilo.`,
    ),
    creatorAngle: idea.angle,
    recordingMission: "Registra una tesi di 60–90 secondi, un esempio personale e una domanda finale per la community.",
    evidence: [],
    sourceIds: [],
    sourceAssessment: "Idea editoriale evergreen: non viene presentata come notizia corrente.",
    sourceTier: "evergreen",
    claimStatus: "evergreen",
    confidenceScore: 100,
    channelFitScore: 92,
    timelinessScore: 65,
    opportunityScore: 84,
    whyItMatters: `È un tema sempre valido e coerente con l'interesse di Miura per ${profile.label.toLowerCase()}.`,
    recommendation: "cover",
  };
}

function safeImperative(value, fallback) {
  const compact = String(value || "").replace(/\s+/gu, " ").trim();
  if (!/^(?:analizza|chiediti|confronta|critica|decidi|difendi|esplora|metti|monitora|mostra|parti|racconta|registra|spiega|trasforma|verifica)\b/iu.test(compact)) {
    return fallback;
  }
  return compact.slice(0, 1_200);
}

export async function buildEvidenceBackedBriefing({
  items,
  complete,
  now = new Date(),
}) {
  const evidence = normalizedEvidence(Array.isArray(items) ? items : [], now);
  const candidates = evidence
    .filter((item) => item.recommendation !== "skip")
    .sort((left, right) => {
      const priority = { cover: 2, monitor: 1, skip: 0 };
      return priority[right.recommendation] - priority[left.recommendation]
        || right.opportunityScore - left.opportunityScore;
    });
  if (!candidates.length) return buildEvergreenBriefing(now);

  const lead = candidates[0];
  const grounded = deterministicNewsCopy(lead);
  let generated = grounded;
  try {
    const modelText = await complete([
      {
        role: "system",
        content: [
          "Sei Mei Ling, strategist privata di Miura.",
          "Usa soltanto il CANDIDATO e la VALUTAZIONE forniti.",
          "Non aggiungere fatti, date o dettagli e non cambiare claimStatus, punteggi o raccomandazione.",
          "Rispondi esclusivamente con JSON valido e le chiavi creatorAngle e recordingMission.",
          "Entrambe devono iniziare con un imperativo concreto e proporre il lavoro di Miura.",
          "Se la raccomandazione è monitor, proponi verifica e preparazione: non trattarla come confermata.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `DATA SCANSIONE: ${now.toISOString()}\nCANDIDATO E VALUTAZIONE:\n${JSON.stringify(lead)}`,
      },
    ], {
      temperature: 0.1,
      topP: 0.7,
      maxTokens: 220,
    });
    generated = parseModelJson(modelText);
  } catch {
    generated = grounded;
  }

  return {
    contentType: "news",
    headline: lead.title,
    spokenSummary: grounded.spokenSummary,
    creatorAngle: safeImperative(generated.creatorAngle, grounded.creatorAngle),
    recordingMission: safeImperative(generated.recordingMission, grounded.recordingMission),
    evidence,
    sourceIds: [lead.id].filter(Boolean),
    sourceAssessment: lead.sourceAssessment,
    sourceTier: lead.sourceTier,
    claimStatus: lead.claimStatus,
    confidenceScore: lead.confidenceScore,
    channelFitScore: lead.channelFitScore,
    timelinessScore: lead.timelinessScore,
    opportunityScore: lead.opportunityScore,
    whyItMatters: lead.whyItMatters,
    recommendation: lead.recommendation,
  };
}
