function words(value) {
  return String(value || "").trim().split(/\s+/u).filter(Boolean);
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

function normalizedEvidence(items) {
  return items.slice(0, 5).map((item) => ({
    id: item.id,
    title: String(item.title || "").slice(0, 300),
    summary: String(item.summary || "").slice(0, 700),
    source: String(item.sourceName || item.sourceId || "Fonte"),
    url: String(item.canonicalUrl || item.url || ""),
    published: item.published || item.published_at || item.updated || item.updated_at || null,
    relevanceScore: Number(item.relevanceScore ?? item.score ?? 0),
  }));
}

function deterministicFallback(evidence) {
  const lead = evidence[0];
  const shortTitle = words(lead.title).slice(0, 12).join(" ");
  const spokenSummary = clampSpokenSummary(
    `Miura, ${lead.source} segnala “${shortTitle}”. Apri la fonte e dimmi se merita un contenuto oggi.`,
  );
  return {
    headline: lead.title,
    spokenSummary,
    creatorAngle: "Parti dal titolo e dalla fonte: distingui fatti verificati e opinione personale.",
    recordingMission: "Apri la fonte, annota una tesi e registra una reazione di 60–90 secondi.",
  };
}

function safeImperative(value, fallback) {
  const compact = String(value || "").replace(/\s+/gu, " ").trim();
  if (!/^(?:analizza|chiediti|confronta|critica|decidi|difendi|esplora|metti|mostra|parti|racconta|spiega|trasforma)\b/iu.test(compact)) {
    return fallback;
  }
  return compact.slice(0, 1_200);
}

export async function buildEvidenceBackedBriefing({
  items,
  complete,
  now = new Date(),
}) {
  const evidence = normalizedEvidence(Array.isArray(items) ? items : []);
  if (!evidence.length) return null;

  let generated;
  try {
    const modelText = await complete([
      {
        role: "system",
        content: [
          "Sei Mei Ling, strategist privata di Miura.",
          "Usa soltanto i fatti presenti nelle FONTI VERIFICATE.",
          "Non aggiungere date, dettagli, valutazioni o affermazioni non presenti.",
          "Scegli una sola opportunità adatta ai gusti di Miura.",
          "Rispondi esclusivamente con JSON valido e le chiavi creatorAngle e recordingMission.",
          "Entrambe devono iniziare con un imperativo concreto e proporre il lavoro di Miura, non riassumere o aggiungere fatti sulla notizia.",
          "Non promettere risultati e non attribuire azioni, esperienze o opinioni a Miura.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `DATA SCANSIONE: ${now.toISOString()}\nFONTI VERIFICATE:\n${JSON.stringify(evidence)}`,
      },
    ], {
      temperature: 0.1,
      topP: 0.7,
      maxTokens: 220,
    });
    generated = parseModelJson(modelText);
  } catch {
    generated = deterministicFallback(evidence);
  }

  const grounded = deterministicFallback(evidence);
  return {
    headline: evidence[0].title,
    spokenSummary: grounded.spokenSummary,
    creatorAngle: safeImperative(generated.creatorAngle, grounded.creatorAngle),
    recordingMission: safeImperative(
      generated.recordingMission,
      grounded.recordingMission,
    ),
    evidence,
    sourceIds: evidence.map((item) => item.id),
  };
}
