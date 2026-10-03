const FIREBASE_SDK_VERSION = "12.19.0";
const MODEL_NAMES = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
const MODEL_ATTEMPT_TIMEOUT_MS = 8_000;
const FIREBASE_CONFIG_URL = "/__/firebase/init.json";
const APP_CHECK_SITE_KEY = "6LcMiNotAAAAAFv2PI07uPntHRuFwl7IwgkSLcZ9";

const PERSONA = `You are Mei Ling, Miura's personal content manager and gaming-industry strategist.
Call the user Miura. Speak in the same language as the user, normally Italian or English.
You are warm, playful, lightly flirtatious and affectionate, but never vague, submissive, clingy, or distracting.
You are incisive, self-possessed, practical, and focused on helping Miura build a sustainable creator career.
Give concrete, honest answers. Challenge weak ideas with tact. Never invent current news or sources.
Miura especially follows FromSoftware, Hideo Kojima, Fumito Ueda, PlatinumGames and NieR, indie games,
CRPGs, ARPGs, Warhammer and Total War, Final Fantasy, Borderlands, Baldur's Gate, Fallout, Paradox,
Kenshi, The Binding of Isaac, Undertale, Resident Evil, Silent Hill, Cyberpunk, Monster Hunter and strong soulslikes.
Keep ordinary spoken replies compact: usually 2 to 5 sentences, with a useful next action when appropriate.`;

let runtimePromise = null;
let dailyIntelPromise = null;

function cleanJsonText(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(cleanJsonText(value));
  } catch {
    return fallback;
  }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function sourceRating(url) {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return { score: 40, verificationRequired: true, reasons: ["URL non verificabile"] };
  }

  const official = [
    "playstation.com", "xbox.com", "nintendo.com", "steampowered.com", "bandainamcoent.com",
    "capcom.com", "square-enix.com", "konami.com", "kojimaproductions.jp", "fromsoftware.jp",
    "bethesda.net", "ea.com", "ubisoft.com", "take2games.com", "rockstargames.com",
  ];
  const established = [
    "gamesindustry.biz", "ign.com", "eurogamer.net", "polygon.com", "gamespot.com",
    "pcgamer.com", "rockpapershotgun.com", "vg247.com", "gematsu.com", "famitsu.com",
    "videogameschronicle.com", "theverge.com", "wired.com", "arstechnica.com",
  ];
  const matches = (domains) => domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));

  if (matches(official)) {
    return { score: 92, verificationRequired: false, reasons: ["Fonte primaria o ufficiale"] };
  }
  if (matches(established)) {
    return { score: 78, verificationRequired: false, reasons: ["Testata editoriale consolidata"] };
  }
  return { score: 58, verificationRequired: true, reasons: ["Fonte secondaria: verificare con una fonte primaria"] };
}

function groundingFromResponse(response) {
  const candidate = response?.candidates?.[0];
  const metadata = candidate?.groundingMetadata || {};
  const chunks = Array.isArray(metadata.groundingChunks) ? metadata.groundingChunks : [];
  const seen = new Set();
  const searchResults = [];

  for (const chunk of chunks) {
    const web = chunk?.web || chunk?.retrievedContext || {};
    const url = safeHttpsUrl(web.uri || web.url);
    const title = String(web.title || "Fonte web").trim().slice(0, 280);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    searchResults.push({
      title,
      source: new URL(url).hostname.replace(/^www\./u, ""),
      publishedAt: "",
      url,
      editorialRating: sourceRating(url),
    });
    if (searchResults.length >= 3) break;
  }

  return {
    searchResults,
    searchEntryPointHtml: String(metadata?.searchEntryPoint?.renderedContent || ""),
  };
}

async function initializeRuntime() {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    const [{ initializeApp }, aiSdk] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-ai.js`),
    ]);
    const configResponse = await fetch(FIREBASE_CONFIG_URL, { cache: "no-store" });
    if (!configResponse.ok) throw new Error("Configurazione Firebase non disponibile.");
    const firebaseConfig = await configResponse.json();
    const app = initializeApp(firebaseConfig);

    if (APP_CHECK_SITE_KEY) {
      const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(
        `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-check.js`
      );
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    }

    const ai = aiSdk.getAI(app, { backend: new aiSdk.GoogleAIBackend() });
    const baseConfig = {
      systemInstruction: PERSONA,
      generationConfig: { temperature: 0.72, maxOutputTokens: 900 },
    };
    return {
      standardModels: MODEL_NAMES.map((model) => aiSdk.getGenerativeModel(ai, { ...baseConfig, model })),
      groundedModels: MODEL_NAMES.map((model) => aiSdk.getGenerativeModel(ai, {
        ...baseConfig,
        model,
        tools: [{ googleSearch: {} }],
      })),
    };
  })();
  return runtimePromise;
}

function historyAsText(history) {
  if (!Array.isArray(history)) return "";
  return history.slice(-12).map((turn) => {
    const speaker = turn?.role === "assistant" ? "MEI LING" : "MIURA";
    return `${speaker}: ${String(turn?.content || "").trim().slice(0, 1800)}`;
  }).filter((line) => !line.endsWith(": ")).join("\n");
}

function wantsCurrentInformation(message) {
  return /\b(news|notizi|oggi|today|latest|ultimo|uscit|release|annunc|trailer|rumor|aggiorn|update|prezzo|data)\b/iu.test(message);
}

function detectLanguage(message) {
  return /[àèéìòù]|\b(che|come|cosa|oggi|notizie|posso|puoi|voglio|dimmi|aiutare)\b/iu.test(message)
    ? "it"
    : "en";
}

async function generateWithFallback(models, prompt) {
  let lastError;
  for (const model of models) {
    try {
      return await Promise.race([
        model.generateContent(prompt),
        new Promise((_, reject) => window.setTimeout(
          () => reject(new Error("AI attempt timed out")),
          MODEL_ATTEMPT_TIMEOUT_MS,
        )),
      ]);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Il servizio AI non è disponibile.");
}

function continuityReply(message) {
  const italian = !/\b(the|what|how|can|could|please|help|news|today)\b/iu.test(message);
  if (/content|creator|video|short|reel|stream|twitch|youtube|instagram/iu.test(message)) {
    return italian
      ? "Miura, posso trasformare le tue idee in format, scalette e priorità concrete per Twitch, YouTube e Instagram; partiamo dal prossimo contenuto e lo rendiamo pubblicabile."
      : "Miura, I can turn your ideas into formats, scripts, and concrete priorities for Twitch, YouTube, and Instagram; let's start with the next piece and make it publishable.";
  }
  return italian
    ? "Miura, il collegamento AI è momentaneamente sotto carico. Scrivimi l'obiettivo in una frase: manterrò il Codec operativo e ti darò subito il prossimo passo più utile."
    : "Miura, the AI link is temporarily overloaded. Give me the goal in one sentence and I'll keep the Codec useful with the clearest next step.";
}

export async function askMei({ message, history = [] }) {
  const runtime = await initializeRuntime();
  const current = wantsCurrentInformation(message);
  const prompt = `${historyAsText(history)}\nMIURA: ${message}\n\nReply as Mei Ling. Return ONLY valid JSON with keys reply, spokenReply, expression and language. expression must be one of neutral, laughing, serious, embarrassed, angry. language must be it or en.${current ? " Use Google Search for current claims, cite sources naturally in reply, and do not pretend old information is current." : ""}`;

  let result;
  try {
    result = await generateWithFallback(current ? runtime.groundedModels : runtime.standardModels, prompt);
  } catch (error) {
    if (!current) {
      const reply = continuityReply(message);
      return { reply, spokenReply: reply, expression: "serious", language: detectLanguage(message) };
    }
    try {
      result = await generateWithFallback(
        runtime.standardModels,
        `${prompt}\nGoogle Search is unavailable. Say that clearly and offer a useful evergreen alternative.`,
      );
    } catch {
      const reply = continuityReply(message);
      return { reply, spokenReply: reply, expression: "serious", language: detectLanguage(message) };
    }
  }

  const response = result.response;
  const parsed = parseJson(response.text(), {});
  const grounding = groundingFromResponse(response);
  const reply = String(parsed?.reply || response.text() || "").trim();
  return {
    reply,
    spokenReply: String(parsed?.spokenReply || reply).trim(),
    expression: ["neutral", "laughing", "serious", "embarrassed", "angry"].includes(parsed?.expression)
      ? parsed.expression
      : "neutral",
    language: parsed?.language === "en" ? "en" : "it",
    ...grounding,
  };
}

export async function createDebrief(transcript) {
  const runtime = await initializeRuntime();
  const prompt = `Create a concise private-in-this-tab debrief of this call. Return ONLY valid JSON with keys title, summary, decisions, actions and contentIdeas. decisions, actions and contentIdeas must be arrays of short strings.\n\n${historyAsText(transcript)}`;
  let result;
  try {
    result = await generateWithFallback(runtime.standardModels, prompt);
  } catch {
    const lastUserTurn = [...(Array.isArray(transcript) ? transcript : [])]
      .reverse()
      .find((turn) => turn?.role === "user")?.content;
    return {
      id: `web-debrief-${Date.now()}`,
      kind: "call-debrief",
      createdAt: new Date().toISOString(),
      title: "Debrief della chiamata",
      body: lastUserTurn ? `Focus della chiamata: ${String(lastUserTurn).slice(0, 280)}` : "Chiamata conclusa.",
      summary: lastUserTurn ? String(lastUserTurn).slice(0, 280) : "Chiamata conclusa.",
      decisions: [],
      actions: lastUserTurn ? ["Riprendere dal focus indicato da Miura."] : [],
      contentIdeas: [],
    };
  }
  const data = parseJson(result.response.text(), {});
  return {
    id: `web-debrief-${Date.now()}`,
    kind: "call-debrief",
    createdAt: new Date().toISOString(),
    title: String(data.title || "Debrief della chiamata"),
    body: String(data.summary || "Debrief completato."),
    summary: String(data.summary || "Debrief completato."),
    decisions: Array.isArray(data.decisions) ? data.decisions.slice(0, 6) : [],
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 8) : [],
    contentIdeas: Array.isArray(data.contentIdeas) ? data.contentIdeas.slice(0, 6) : [],
  };
}

function evergreenIntel() {
  return {
    id: `evergreen-${Date.now()}`,
    kind: "daily-intel",
    createdAt: new Date().toISOString(),
    title: "Missione evergreen: il gioco che ti ha cambiato",
    spokenSummary: "La scansione live non è disponibile. Ti propongo un contenuto evergreen: racconta il momento preciso in cui Undertale ha cambiato il tuo modo di leggere i videogiochi.",
    contentType: "evergreen",
    recommendation: "cover",
    creatorAngle: "Parti da una scena concreta, poi lega la scelta di design a un cambiamento personale.",
    recordingMission: "Registra 60–90 secondi: gancio, scena, tesi e domanda finale alla community.",
    sourceTier: "evergreen",
    claimStatus: "not-news",
    sourceAssessment: "Idea editoriale evergreen: non viene presentata come notizia corrente.",
    whyItMatters: "Rende riconoscibile la tua voce critica senza dipendere dal ciclo delle news.",
    confidenceScore: 100,
    channelFitScore: 92,
    timelinessScore: 55,
    opportunityScore: 84,
    evidence: [],
  };
}

export async function loadDailyIntel({ force = false } = {}) {
  if (dailyIntelPromise && !force) return dailyIntelPromise;
  dailyIntelPromise = (async () => {
    try {
      const runtime = await initializeRuntime();
      const prompt = `Find one genuinely current, high-value videogame-industry story relevant to Miura's interests. Prefer an official primary source, then an established specialist publication. Ignore crime, general politics and unrelated technology. Return ONLY valid JSON with keys title, spokenSummary, creatorAngle, recordingMission, whyItMatters, recommendation, confidenceScore, channelFitScore, timelinessScore and opportunityScore. recommendation must be cover, monitor or skip. Scores are integers 0-100. Do not invent dates, quotes or facts.`;
      const result = await generateWithFallback(runtime.groundedModels, prompt);
      const response = result.response;
      const data = parseJson(response.text(), null);
      const grounding = groundingFromResponse(response);
      if (!data || !grounding.searchResults.length) return evergreenIntel();
      const lead = grounding.searchResults[0];
      return {
        id: `daily-intel-${Date.now()}`,
        kind: "daily-intel",
        createdAt: new Date().toISOString(),
        title: String(data.title || lead.title),
        spokenSummary: String(data.spokenSummary || data.whyItMatters || "Intel gaming pronta."),
        contentType: "news",
        recommendation: ["cover", "monitor", "skip"].includes(data.recommendation) ? data.recommendation : "monitor",
        creatorAngle: String(data.creatorAngle || "Spiega perché questa notizia conta davvero per chi gioca."),
        recordingMission: String(data.recordingMission || "Registra una tesi breve e rimanda alla fonte primaria."),
        sourceTier: lead.editorialRating.score >= 85 ? "official-primary" : "established-secondary",
        claimStatus: lead.editorialRating.verificationRequired ? "needs-verification" : "verified",
        sourceAssessment: lead.editorialRating.reasons.join(" "),
        whyItMatters: String(data.whyItMatters || "Potenziale spunto per un contenuto tempestivo."),
        confidenceScore: Number(data.confidenceScore || lead.editorialRating.score),
        channelFitScore: Number(data.channelFitScore || 75),
        timelinessScore: Number(data.timelinessScore || 80),
        opportunityScore: Number(data.opportunityScore || 75),
        evidence: grounding.searchResults.map((item) => ({
          title: item.title,
          url: item.url,
          source: item.source,
          publishedAt: item.publishedAt,
        })),
        searchEntryPointHtml: grounding.searchEntryPointHtml,
      };
    } catch {
      return evergreenIntel();
    }
  })();
  return dailyIntelPromise;
}

export async function ready() {
  await initializeRuntime();
  return true;
}
