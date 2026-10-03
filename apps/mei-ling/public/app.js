import { isMeiLingWakePhrase, wakePhraseLabel } from "./wake-word.js";
import { createPauseAwareTurnDetector, isLowInformationVoiceInput } from "./turn-detector.js";
import {
  classifyMicrophoneError,
  hasUsableAudioTrack,
  shouldRearmLocalRecorder,
} from "./voice-input.js";
import {
  describeRuntimeConnection,
  describeRuntimeHealth,
} from "./runtime-readiness.js";
import { normalizeNewsResults } from "./news-result.js";

const codec = document.querySelector(".codec");
const clock = document.querySelector("#clock");
const meiPortrait = document.querySelector(".portrait--mei");
const miuraPortrait = document.querySelector(".portrait--miura");
const meiPortraitImage = document.querySelector("#meiPortraitImage");
const transcript = document.querySelector("#codecTranscript");
const transcriptSpeaker = document.querySelector("#transcriptSpeaker");
const transcriptText = document.querySelector("#transcriptText");
const callHistory = document.querySelector("#callHistory");
const callStatus = document.querySelector("#callStatus");
const hangupButton = document.querySelector("#codecHangup");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const messageSubmit = document.querySelector("#messageSubmit");
const panelHandle = document.querySelector("#codecPanelHandle");
const panelBackdrop = document.querySelector("#codecPanelBackdrop");
const panel = document.querySelector("#codecPanel");
const panelClose = document.querySelector("#codecPanelClose");
const panelRefresh = document.querySelector("#codecPanelRefresh");
const panelTitle = document.querySelector("#codecPanelTitle");
const panelStatus = document.querySelector("#codecPanelStatus");
const panelSwipeGrip = document.querySelector("#codecPanelSwipeGrip");
const panelTabs = [...document.querySelectorAll("[data-panel-tab]")];
const panelSections = [...document.querySelectorAll("[data-panel-section]")];
const intelContent = document.querySelector("#intelContent");
const debriefContent = document.querySelector("#debriefContent");
const memoryContent = document.querySelector("#memoryContent");
const wakeToggle = document.querySelector("#wakeToggle");
const wakeToggleLabel = document.querySelector("#wakeToggleLabel");
const publicDemoNotice = document.querySelector("#publicDemoNotice");

const assetUrl = (path) => new URL(String(path || "").replace(/^\/+/, ""), import.meta.url).href;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const browserLanguage = (navigator.languages?.[0] || navigator.language || "it-IT").toLowerCase();
const sessionId = crypto.randomUUID?.() || `mei-${Date.now()}`;
const CLIENT_VERSION = "10";
const codecRing = new Audio(assetUrl("audio/metal-gear-codec.mp3"));
const codecDisconnect = new Audio(assetUrl("audio/codec-disconnect.wav"));
const activeRequests = new Set();
let panelOrder = Object.freeze(["intel", "debrief", "memory"]);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const inputModes = new Set(["voice-local", "voice-browser", "text"]);
const liveTranscriptStatuses = new Set([
  "MIC ACCESS",
  "LOCAL MIC",
  "RECORDING",
  "TRANSCRIBING",
  "MIC RETRY",
  "BROWSER MIC",
  "BROWSER RETRY",
]);
const knownPhantomInputs = new Set([
  "thanks for watching",
  "thank you for watching",
  "www mooji org",
  "miura mei ling twitch youtube instagram kojima fromsoftware",
]);
const LISTEN_AFTER_SPEECH_MS = 480;
const CODEC_RING_SAFETY_MS = 16_500;
const WAKE_PREFERENCE_KEY = "mei-ling-wake-enabled-v8";
const RUNTIME_HEALTH_RETRY_MS = 1_100;

let appConfig = {
  publicDemo: false,
  clientAI: false,
  capabilities: {
    textChat: true,
    dailyIntel: true,
    debrief: true,
    memory: true,
    voice: true,
    microphone: true,
    wakeWord: true,
    proactiveCalls: true,
  },
};

async function loadAppConfig() {
  try {
    const response = await fetch("/api/config", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (response.ok) appConfig = { ...appConfig, ...(await response.json()) };
  } catch {
    // Local desktop builds made before the config endpoint keep full capabilities.
  }
  if (window.location.pathname === "/meiling" || window.location.pathname.startsWith("/meiling/")) {
    appConfig = {
      ...appConfig,
      publicDemo: true,
      clientAI: true,
      capabilities: {
        ...appConfig.capabilities,
        memory: false,
        voice: true,
        microphone: Boolean(SpeechRecognition),
        wakeWord: false,
        proactiveCalls: false,
      },
    };
  }
  document.body.dataset.appMode = appConfig.publicDemo ? "public-demo" : "local-full";
  if (!appConfig.publicDemo) return;
  if (publicDemoNotice) publicDemoNotice.hidden = false;
  panelOrder = Object.freeze(["intel", "debrief"]);
  wakeToggle.hidden = true;
  const memoryTab = panelTabs.find((tab) => tab.dataset.panelTab === "memory");
  const memorySection = panelSections.find((section) => section.dataset.panelSection === "memory");
  if (memoryTab) memoryTab.hidden = true;
  if (memorySection) memorySection.hidden = true;
}

codecRing.preload = "auto";
codecRing.volume = 0.78;
codecDisconnect.preload = "auto";
codecDisconnect.volume = 0.78;

const meiExpressions = Object.freeze({
  neutral: assetUrl("figma-mei-manga-approved.png"),
  laughing: assetUrl("mei-expression-laughing-v1.png"),
  serious: assetUrl("mei-expression-serious-v1.png"),
  embarrassed: assetUrl("mei-expression-embarrassed-v1.png"),
  angry: assetUrl("mei-expression-angry-v1.png"),
});

const stateLabels = Object.freeze({
  idle: "STANDBY",
  calling: "CALLING",
  incoming: "INCOMING",
  connected: "LINK ACTIVE",
  listening: "LISTENING",
  thinking: "PROCESSING",
  speaking: "TRANSMITTING",
  closing: "CLOSING",
  debriefing: "DEBRIEF",
  error: "LINK LOST",
});

let connected = false;
let calling = false;
let incomingCall = false;
let busy = false;
let recognition = null;
let recognitionActive = false;
let recognitionBlocked = !SpeechRecognition;
let recognitionLanguage = browserLanguage.startsWith("en") ? "en-US" : "it-IT";
let recognitionRestartTimer = null;
let callTimer = null;
let ringSafetyTimer = null;
let revealTimer = null;
let transcriptHideTimer = null;
let currentSpeechAudio = null;
let currentSpeechUtterance = null;
let speechFallbackActive = false;
let speechEpoch = 0;
let currentSpeechCancel = null;
let lastFinalTranscript = "";
let microphoneStream = null;
let microphonePromise = null;
let microphoneGeneration = 0;
let listeningStartPromise = null;
let listeningStartQueued = false;
let callIntroPending = false;
let microphoneSource = null;
let mediaRecorder = null;
let audioContext = null;
let analyser = null;
let vadTimer = null;
let localListening = false;
let localMicBlocked = false;
let localSttFailed = false;
let localMicError = "";
let localRetryTimer = null;
let silentMicCycles = 0;
let discardRecording = false;
let callEpoch = 0;
let pendingBriefingId = null;
let briefingEvents = null;
let serviceWorkerRegistrationPromise = null;
let notificationPermissionRequested = false;
let endingCall = false;
let currentCallTranscript = [];
let panelOpen = false;
let activePanelTab = "intel";
let panelReturnFocus = null;
let suppressPanelClickUntil = 0;
let latestDebrief = null;
let latestDebriefError = "";
let liveDebriefTimer = 0;
let liveDebriefSequence = 0;
let panelData = {
  briefings: [],
  instructions: [],
  status: null,
  sources: [],
};

let wakeArmed = false;
let wakeListening = false;
let wakeTranscribing = false;
let wakeRecorder = null;
let wakeVadTimer = null;
let wakeRestartTimer = null;
let wakeDiscardRecording = false;
let wakeStarting = false;
let wakeEpoch = 0;
let runtimeReadiness = describeRuntimeConnection();
let runtimeHealthTimer = null;
let runtimeHealthRequest = null;
function setMeiExpression(expression = "neutral") {
  const next = Object.prototype.hasOwnProperty.call(meiExpressions, expression)
    ? expression
    : "neutral";
  if (meiPortrait.dataset.expression === next) return;

  meiPortrait.classList.add("is-changing-expression");
  const preload = new Image();
  preload.onload = () => {
    meiPortraitImage.src = preload.src;
    meiPortrait.dataset.expression = next;
    window.setTimeout(() => meiPortrait.classList.remove("is-changing-expression"), 90);
  };
  preload.onerror = () => meiPortrait.classList.remove("is-changing-expression");
  preload.src = meiExpressions[next];
}

Object.values(meiExpressions).forEach((source) => {
  const image = new Image();
  image.src = source;
});

window.meiLingExpression = setMeiExpression;
window.meiLingExpressions = Object.keys(meiExpressions);
window.applyMeiReply = (payload) => {
  setMeiExpression(payload?.expression || "neutral");
  return payload?.reply || "";
};

function updateClock() {
  clock.textContent = new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function syncPortraitState(state) {
  let mode = "none";
  if (connected) mode = "both";
  else if (incomingCall || state === "incoming") mode = "mei";
  else if (calling || state === "calling") mode = "miura";

  codec.dataset.portraits = mode;
  const showMei = mode === "mei" || mode === "both";
  const showMiura = mode === "miura" || mode === "both";
  meiPortrait.hidden = !showMei;
  miuraPortrait.hidden = !showMiura;
  meiPortrait.setAttribute("aria-hidden", showMei ? "false" : "true");
  miuraPortrait.setAttribute("aria-hidden", showMiura ? "false" : "true");
}

function setState(state, status = stateLabels[state]) {
  codec.dataset.state = state;
  callStatus.textContent = status || stateLabels[state] || "LINK ACTIVE";

  const runtimeBlocked = !runtimeReadiness.ready
    && !connected
    && !calling
    && !incomingCall;
  let actionLabel = "Chiama Mei Ling";
  if (endingCall || state === "closing" || state === "debriefing") {
    actionLabel = "Chiusura della chiamata in corso";
  } else if (runtimeBlocked) {
    actionLabel = "Servizi locali in avvio";
  } else if (incomingCall || state === "incoming") {
    actionLabel = "Rispondi alla chiamata di Mei Ling";
  } else if (connected) {
    actionLabel = "Chiamata attiva. Usa il pulsante END per terminare";
  } else if (calling) {
    actionLabel = "Annulla la chiamata a Mei Ling";
  }

  codec.setAttribute("aria-label", actionLabel);
  codec.setAttribute(
    "aria-disabled",
    endingCall || connected || runtimeBlocked ? "true" : "false",
  );
  syncPortraitState(state);
  syncCallControls();
}

function syncCallControls() {
  const canWrite = connected && !endingCall;
  messageForm.hidden = !canWrite;
  hangupButton.hidden = !((connected || calling || incomingCall) && !endingCall);

  if (connected) {
    hangupButton.textContent = "END";
    hangupButton.setAttribute("aria-label", "Termina la chiamata e crea il debrief");
  } else if (incomingCall) {
    hangupButton.textContent = "DECLINE";
    hangupButton.setAttribute("aria-label", "Rifiuta la chiamata in arrivo");
  } else {
    hangupButton.textContent = "CANCEL";
    hangupButton.setAttribute("aria-label", "Annulla la chiamata in uscita");
  }
  syncWakeUi();
}

function setComposerBusy(value) {
  messageForm.setAttribute("aria-busy", value ? "true" : "false");
  messageSubmit.disabled = Boolean(value);
}

function showTranscript(speaker, text, status) {
  window.clearTimeout(transcriptHideTimer);
  transcript.hidden = false;
  transcriptSpeaker.textContent = speaker;
  transcriptText.textContent = text;
  transcriptText.hidden = Boolean(
    currentCallTranscript.length
    && (speaker === "MIURA" || speaker === "MEI LING")
    && status !== "LISTENING"
    && status !== "HEARING"
    && !liveTranscriptStatuses.has(status),
  );
  if (status) callStatus.textContent = status;
}

function renderRuntimeReadiness({ announce = true } = {}) {
  const activeCall = connected || calling || incomingCall || endingCall;
  codec.dataset.runtime = runtimeReadiness.ready ? "ready" : "warming";
  syncWakeUi();
  if (activeCall) return;

  if (runtimeReadiness.ready) {
    setState("idle");
    if (transcript.dataset.runtimeWarmup === "true") {
      transcript.hidden = true;
      delete transcript.dataset.runtimeWarmup;
    }
    return;
  }

  setState("idle", runtimeReadiness.status);
  if (announce) {
    transcript.dataset.runtimeWarmup = "true";
    showTranscript("CODEC", runtimeReadiness.message, runtimeReadiness.status);
  }
}

function scheduleRuntimeHealthPoll() {
  window.clearTimeout(runtimeHealthTimer);
  runtimeHealthTimer = null;
  if (runtimeReadiness.ready) return;
  runtimeHealthTimer = window.setTimeout(() => {
    runtimeHealthTimer = null;
    void refreshRuntimeHealth();
  }, RUNTIME_HEALTH_RETRY_MS);
}

async function refreshRuntimeHealth() {
  if (appConfig.publicDemo) {
    runtimeReadiness = { ready: true, status: "WEB READY", message: "", pending: [] };
    renderRuntimeReadiness();
    return runtimeReadiness;
  }
  if (runtimeHealthRequest) return runtimeHealthRequest;
  const request = (async () => {
    const wasReady = runtimeReadiness.ready;
    try {
      const response = await fetchWithTimeout("/api/health", {
        headers: { Accept: "application/json" },
      }, 10_000);
      const payload = await response.json().catch(() => ({}));
      runtimeReadiness = describeRuntimeHealth(payload);
    } catch {
      runtimeReadiness = describeRuntimeConnection();
    }
    renderRuntimeReadiness();
    if (
      !wasReady
      && runtimeReadiness.ready
      && pendingBriefingId
      && document.visibilityState === "visible"
      && document.hasFocus()
    ) {
      void triggerIncomingCall();
    }
    if (!runtimeReadiness.ready) scheduleRuntimeHealthPoll();
    return runtimeReadiness;
  })();
  runtimeHealthRequest = request;
  try {
    return await request;
  } finally {
    if (runtimeHealthRequest === request) runtimeHealthRequest = null;
  }
}

function showRuntimeWarmupStatus() {
  renderRuntimeReadiness();
  void refreshRuntimeHealth();
}

function hideTranscriptSoon(delay = 1400) {
  window.clearTimeout(transcriptHideTimer);
  transcriptHideTimer = window.setTimeout(() => {
    if (!connected && !calling) transcript.hidden = true;
  }, delay);
}

function playReveal({ replayAnimation = false } = {}) {
  if (replayAnimation) {
    codec.classList.remove("is-appearing");
    void codec.offsetWidth;
  }
  codec.classList.add("is-appearing");
  window.clearTimeout(revealTimer);
  revealTimer = window.setTimeout(() => codec.classList.remove("is-appearing"), 1900);
}

function startRing() {
  stopRing();
  codec.classList.add("is-ringing");
  codecRing.loop = false;
  codecRing.currentTime = 0;
  codecRing.onended = stopRing;
  ringSafetyTimer = window.setTimeout(stopRing, CODEC_RING_SAFETY_MS);
  codecRing.play().catch(() => {
    stopRing();
    showTranscript("CODEC", "AUDIO BLOCCATO DAL BROWSER", "AUDIO LOCKED");
  });
}

function stopRing() {
  window.clearTimeout(ringSafetyTimer);
  ringSafetyTimer = null;
  codecRing.onended = null;
  codecRing.pause();
  codecRing.currentTime = 0;
  codecRing.loop = false;
  codec.classList.remove("is-ringing");
}

function clearCallTimers() {
  window.clearTimeout(callTimer);
  window.clearTimeout(recognitionRestartTimer);
  callTimer = null;
  recognitionRestartTimer = null;
}

function waitForMicrophone(promise) {
  return Promise.race([
    promise,
    new Promise((resolve) => window.setTimeout(() => resolve(false), 12000)),
  ]);
}

async function fetchWithTimeout(resource, options = {}, timeout = 45_000) {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  activeRequests.add(controller);

  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error("TEMPO DI RISPOSTA SCADUTO");
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    activeRequests.delete(controller);
  }
}

function cancelActiveRequests() {
  activeRequests.forEach((controller) => controller.abort());
  activeRequests.clear();
}

function normalizeSpokenInput(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isKnownPhantomInput(value) {
  const normalized = normalizeSpokenInput(value);
  if (!normalized) return false;
  if (knownPhantomInputs.has(normalized)) return true;
  return [...knownPhantomInputs].some(
    (known) => normalized.includes(known) && normalized.length <= known.length + 24,
  );
}

function createNewsResultsList(results) {
  const list = document.createElement("ol");
  list.className = "codec-news-results";
  list.setAttribute("aria-label", "Notizie trovate");

  results.forEach((result) => {
    const item = document.createElement("li");
    item.className = "codec-news-result";

    const header = document.createElement("div");
    header.className = "codec-news-result__header";

    const title = document.createElement("p");
    title.className = "codec-news-result__title";
    title.textContent = result.title;

    const rating = document.createElement("span");
    rating.className = "codec-news-result__rating";
    rating.textContent = `RATING EDITORIALE ${result.editorialRating.score} / 100 · ${result.editorialRating.label}`;
    header.append(title, rating);

    const details = document.createElement("p");
    details.className = "codec-news-result__details";
    details.textContent = `FONTE: ${result.source || "NON INDICATA"} · DATA: ${formatPanelDate(result.publishedAt)}`;

    item.append(header, details);

    if (result.editorialRating.verificationRequired) {
      const verification = document.createElement("span");
      verification.className = "codec-news-result__verification";
      verification.textContent = "DA VERIFICARE";
      item.append(verification);
    }

    const link = document.createElement("a");
    link.className = "codec-news-result__link";
    link.href = result.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "APRI NOTIZIA ↗";
    link.setAttribute("aria-label", `Apri notizia: ${result.title}`);
    item.append(link);
    list.append(item);
  });

  return list;
}

function createSearchEntryPoint(renderedContent) {
  const html = String(renderedContent || "").trim();
  if (!html) return null;
  const entryPoint = document.createElement("div");
  entryPoint.className = "codec-search-entry-point";
  entryPoint.setAttribute("aria-label", "Google Search suggestions");
  entryPoint.innerHTML = html;
  return entryPoint;
}

function renderCallHistory() {
  const fragment = document.createDocumentFragment();
  currentCallTranscript.forEach(({ role, content, searchResults = [], searchEntryPointHtml = "" }) => {
    const turn = document.createElement("li");
    turn.className = `codec-call-history__turn codec-call-history__turn--${role}`;
    const speaker = document.createElement("span");
    speaker.className = "codec-call-history__speaker";
    speaker.textContent = role === "assistant" ? "MEI LING" : "MIURA";
    const body = document.createElement("div");
    body.className = "codec-call-history__body";
    const text = document.createElement("p");
    text.className = "codec-call-history__text";
    text.textContent = content;
    body.append(text);
    const searchEntryPoint = createSearchEntryPoint(searchEntryPointHtml);
    if (searchEntryPoint) body.append(searchEntryPoint);
    if (searchResults.length) body.append(createNewsResultsList(searchResults));
    turn.append(speaker, body);
    fragment.append(turn);
  });
  callHistory.replaceChildren(fragment);
  callHistory.hidden = currentCallTranscript.length === 0;
  window.requestAnimationFrame(() => {
    callHistory.scrollTop = callHistory.scrollHeight;
  });
}

function rememberCallTurn(role, content, { searchResults = [], searchEntryPointHtml = "" } = {}) {
  if (role !== "user" && role !== "assistant") return;
  const clean = String(content || "").replace(/\s+/gu, " ").trim().slice(0, 6000);
  if (!clean) return;
  currentCallTranscript.push({
    role,
    content: clean,
    searchResults: role === "assistant" ? normalizeNewsResults(searchResults) : [],
    searchEntryPointHtml: role === "assistant" ? String(searchEntryPointHtml || "") : "",
  });
  if (currentCallTranscript.length > 80) {
    currentCallTranscript = currentCallTranscript.slice(-80);
  }
  renderCallHistory();
}

function resetCallTranscript() {
  window.clearTimeout(liveDebriefTimer);
  liveDebriefSequence += 1;
  currentCallTranscript = [];
  renderCallHistory();
}

function scheduleLiveDebrief() {
  window.clearTimeout(liveDebriefTimer);
  if (!connected || currentCallTranscript.length < 2) return;
  const sequence = ++liveDebriefSequence;
  const transcript = currentCallTranscript.map(({ role, content }) => ({ role, content }));
  liveDebriefTimer = window.setTimeout(async () => {
    try {
      let item;
      if (appConfig.clientAI) {
        const { createDebrief } = await import("./firebase-ai-client.js?v=23");
        item = await createDebrief(transcript);
      } else {
        const response = await fetchWithTimeout("/api/debrief/preview", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, transcript }),
        }, 45_000);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.item) throw new Error(payload?.error || "Debrief live non disponibile.");
        item = payload.item;
      }
      if (sequence !== liveDebriefSequence) return;
      latestDebrief = item;
      latestDebriefError = "";
      renderDebriefPanel();
    } catch (error) {
      if (sequence !== liveDebriefSequence || error?.name === "AbortError") return;
      latestDebriefError = String(error?.message || "Debrief live non disponibile.");
      renderDebriefPanel();
    }
  }, 350);
}

function clearPanelContent(container) {
  container.replaceChildren();
}

function formatPanelDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function addPanelEmpty(container, message) {
  const empty = document.createElement("p");
  empty.className = "codec-data-empty";
  empty.textContent = message;
  container.append(empty);
}

function addPanelBlock(container, { label, title, text, items, keyValues } = {}) {
  const block = document.createElement("section");
  block.className = "codec-data-block";

  if (label) {
    const eyebrow = document.createElement("p");
    eyebrow.className = "codec-data-block__label";
    eyebrow.textContent = label;
    block.append(eyebrow);
  }
  if (title) {
    const heading = document.createElement("h3");
    heading.className = "codec-data-block__title";
    heading.textContent = title;
    block.append(heading);
  }
  if (text) {
    const paragraph = document.createElement("p");
    paragraph.className = "codec-data-block__text";
    paragraph.textContent = text;
    block.append(paragraph);
  }
  if (Array.isArray(items) && items.length) {
    const list = document.createElement("ul");
    list.className = "codec-data-list";
    items.forEach((item) => {
      const row = document.createElement("li");
      row.textContent = String(item || "");
      list.append(row);
    });
    block.append(list);
  }
  if (Array.isArray(keyValues) && keyValues.length) {
    const list = document.createElement("dl");
    list.className = "codec-data-kv";
    keyValues.forEach(([key, value]) => {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = String(key || "");
      detail.textContent = String(value ?? "—");
      row.append(term, detail);
      list.append(row);
    });
    block.append(list);
  }
  container.append(block);
  return block;
}

const intelPanelLabels = Object.freeze({
  contentType: { news: "NOTIZIA", evergreen: "IDEA EVERGREEN" },
  sourceTier: {
    "official-primary": "UFFICIALE / PRIMARIA",
    aggregator: "AGGREGATORE",
    evergreen: "PROFILO EDITORIALE",
    unknown: "NON VERIFICATA",
  },
  claimStatus: {
    confirmed: "CONFERMATA",
    reported: "SEGNALATA, DA VERIFICARE",
    evergreen: "IDEA, NON NOTIZIA",
  },
  recommendation: { cover: "COPRI", monitor: "MONITORA", skip: "SCARTA" },
});

function intelPanelLabel(group, value, fallback = "—") {
  return intelPanelLabels[group]?.[String(value || "").trim().toLowerCase()] || fallback;
}

function intelPanelScore(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? String(Math.max(0, Math.min(100, Math.round(numeric)))) + " / 100"
    : "—";
}

function addIntelEvaluation(container, intel) {
  const evergreen = String(intel.contentType || "news").toLowerCase() === "evergreen";
  const recommendation = String(intel.recommendation || "monitor").toLowerCase();
  const text = [
    intel.sourceAssessment,
    intel.whyItMatters ? "PERCHÉ CONTA // " + intel.whyItMatters : "",
  ].filter(Boolean).join("\n\n");
  const block = addPanelBlock(container, {
    label: "VALUTAZIONE // " + intelPanelLabel("contentType", intel.contentType, "NOTIZIA"),
    title: evergreen
      ? "IDEA EDITORIALE — NON È UNA NOTIZIA"
      : intelPanelLabel("recommendation", recommendation, "MONITORA"),
    text,
    keyValues: [
      ["RACCOMANDAZIONE", intelPanelLabel("recommendation", recommendation, "MONITORA")],
      [evergreen ? "BASE" : "FONTE", intelPanelLabel("sourceTier", intel.sourceTier, "NON VERIFICATA")],
      [evergreen ? "STATO" : "CLAIM", intelPanelLabel("claimStatus", intel.claimStatus, "DA VERIFICARE")],
      [evergreen ? "SOLIDITÀ" : "CONFIDENZA", intelPanelScore(intel.confidenceScore)],
      ["FIT CANALE", intelPanelScore(intel.channelFitScore)],
      ["ATTUALITÀ", intelPanelScore(intel.timelinessScore)],
      ["OPPORTUNITÀ", intelPanelScore(intel.opportunityScore)],
    ],
  });
  block.classList.add("codec-intel-evaluation");
  block.dataset.contentType = evergreen ? "evergreen" : "news";
  block.dataset.recommendation = recommendation;
}

function renderIntelPanel() {
  clearPanelContent(intelContent);
  const intel = panelData.briefings.find((item) => item?.kind === "daily-intel");
  if (!intel) {
    addPanelEmpty(intelContent, "Nessun Daily Intel disponibile. Mei Ling mostrerà qui fonti, angolo editoriale e missione di registrazione.");
    return;
  }

  addPanelBlock(intelContent, {
    label: `DAILY INTEL // ${formatPanelDate(intel.createdAt)}`,
    title: intel.title || "Briefing di Mei Ling",
    text: intel.spokenSummary || "Briefing pronto.",
  });
  addIntelEvaluation(intelContent, intel);
  if (intel.creatorAngle) {
    addPanelBlock(intelContent, {
      label: "CREATOR ANGLE",
      text: intel.creatorAngle,
    });
  }
  if (intel.recordingMission) {
    addPanelBlock(intelContent, {
      label: "RECORDING MISSION",
      text: intel.recordingMission,
    });
  }

  const evidence = Array.isArray(intel.evidence)
    ? intel.evidence.map((item) => {
      if (typeof item === "string") return item;
      const title = String(item?.title || "Fonte verificata");
      const source = String(item?.source || "Fonte");
      const url = String(item?.url || item?.canonicalUrl || "").trim();
      return [source + " — " + title, url].filter(Boolean).join("\n");
    }).filter(Boolean)
    : [];
  if (evidence.length) {
    addPanelBlock(intelContent, {
      label: "EVIDENCE",
      items: evidence,
    });
  }
}

function renderDebriefPanel() {
  clearPanelContent(debriefContent);
  const stored = panelData.briefings.find((item) => item?.kind === "call-debrief");
  const item = latestDebrief || stored;
  if (!item) {
    addPanelEmpty(
      debriefContent,
      latestDebriefError || "Chiudi una conversazione con Mei Ling: qui troverai decisioni, idee, task e prossimi passi.",
    );
    return;
  }

  addPanelBlock(debriefContent, {
    label: `CALL DEBRIEF // ${formatPanelDate(item.createdAt)}`,
    title: item.title || "Debrief Codec",
    text: item.summary || item.spokenSummary || (item.persistent === false ? "Debrief temporaneo pronto." : "Debrief salvato."),
  });
  if (Array.isArray(item.decisions) && item.decisions.length) {
    addPanelBlock(debriefContent, { label: "DECISIONI", items: item.decisions });
  }
  if (Array.isArray(item.ideas) && item.ideas.length) {
    addPanelBlock(debriefContent, { label: "IDEE", items: item.ideas });
  }
  if (Array.isArray(item.tasks) && item.tasks.length) {
    addPanelBlock(debriefContent, {
      label: "TASK",
      items: item.tasks.map((task) => {
        if (typeof task === "string") return task;
        const owner = task?.owner ? ` · ${task.owner}` : "";
        const status = task?.status ? ` · ${task.status}` : "";
        return `${task?.text || "Task"}${owner}${status}`;
      }),
    });
  }
  if (Array.isArray(item.followUps) && item.followUps.length) {
    addPanelBlock(debriefContent, { label: "FOLLOW-UP", items: item.followUps });
  }
  addPanelBlock(debriefContent, {
    label: "TRACE",
    keyValues: [
      ["Estrazione", item.extractionMode || "locale"],
      ["Turni", item.transcript?.turnCount ?? "—"],
      [item.persistent === false ? "Sessione" : "Salvato", formatPanelDate(item.createdAt)],
    ],
  });
}

function readableStatusKey(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLocaleUpperCase("it");
}

function renderMemoryPanel() {
  clearPanelContent(memoryContent);
  const enabledInstructions = panelData.instructions.filter((item) => item?.enabled !== false);
  if (enabledInstructions.length) {
    addPanelBlock(memoryContent, {
      label: "ISTRUZIONI ATTIVE",
      items: enabledInstructions.map((item) => {
        const scope = item?.scope ? `[${String(item.scope).toLocaleUpperCase("it")}] ` : "";
        return `${scope}${item?.text || "Istruzione"}`;
      }),
    });
  } else {
    addPanelEmpty(memoryContent, "Nessuna istruzione persistente disponibile.");
  }

  if (panelData.status && typeof panelData.status === "object") {
    const statusRows = Object.entries(panelData.status)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) || value === null)
      .slice(0, 14)
      .map(([key, value]) => [readableStatusKey(key), value === null ? "—" : value]);
    if (statusRows.length) {
      addPanelBlock(memoryContent, {
        label: "BRAIN STATUS",
        keyValues: statusRows,
      });
    }
  }

  if (panelData.sources.length) {
    addPanelBlock(memoryContent, {
      label: `FONTI PUBBLICHE // ${panelData.sources.length}`,
      items: panelData.sources.map((source) => {
        const state = source?.lastStatus ? ` · ${source.lastStatus}` : "";
        return `${source?.title || source?.id || "Fonte"}${state}`;
      }),
    });
  }
}

function renderPanels() {
  renderIntelPanel();
  renderDebriefPanel();
  renderMemoryPanel();
}

async function fetchPanelResource(path) {
  const response = await fetchWithTimeout(path, {
    headers: { Accept: "application/json" },
  }, 18_000);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

async function refreshPanelData({ announce = false } = {}) {
  if (appConfig.clientAI) {
    if (announce) panelStatus.textContent = "Sincronizzazione Intel in corso.";
    try {
      const { loadDailyIntel } = await import("./firebase-ai-client.js?v=23");
      const intel = await loadDailyIntel();
      panelData = { briefings: [intel], instructions: [], status: null, sources: [] };
      renderPanels();
      if (announce) panelStatus.textContent = "Pannelli di Mei Ling aggiornati.";
    } catch (error) {
      if (announce) panelStatus.textContent = String(error?.message || "Intel non disponibile.");
    }
    return;
  }
  if (announce) panelStatus.textContent = "Sincronizzazione pannelli in corso.";
  const results = await Promise.allSettled([
    fetchPanelResource("/api/briefings?limit=20"),
    fetchPanelResource("/api/instructions"),
    fetchPanelResource("/api/brain/status"),
    fetchPanelResource("/api/sources"),
  ]);

  const [briefingsResult, instructionsResult, statusResult, sourcesResult] = results;
  if (briefingsResult.status === "fulfilled") {
    panelData.briefings = Array.isArray(briefingsResult.value?.items)
      ? briefingsResult.value.items
      : [];
  }
  if (instructionsResult.status === "fulfilled") {
    panelData.instructions = Array.isArray(instructionsResult.value?.items)
      ? instructionsResult.value.items
      : [];
  }
  if (statusResult.status === "fulfilled") panelData.status = statusResult.value || null;
  if (sourcesResult.status === "fulfilled") {
    panelData.sources = Array.isArray(sourcesResult.value?.items)
      ? sourcesResult.value.items
      : [];
  }

  renderPanels();
  if (announce) {
    const failed = results.filter((result) => result.status === "rejected").length;
    panelStatus.textContent = failed
      ? `Sincronizzazione parziale. ${failed} fonti locali non disponibili.`
      : "Pannelli di Mei Ling aggiornati.";
  }
}

async function refreshIntelNow() {
  if (appConfig.clientAI) {
    panelStatus.textContent = "Scansione gaming globale in corso.";
    const { loadDailyIntel } = await import("./firebase-ai-client.js?v=23");
    const intel = await loadDailyIntel({ force: true });
    panelData.briefings = [intel];
    renderPanels();
    panelStatus.textContent = intel.contentType === "news"
      ? "Intel gaming aggiornata con fonti live."
      : "Nessuna news solida: missione evergreen pronta.";
    return;
  }
  panelStatus.textContent = "Scansione gaming globale in corso.";
  const response = await fetchWithTimeout("/api/brain/run", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ force: true }),
  }, 90_000);
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw new Error(failure.error || `Scansione Intel: ${response.status}`);
  }
  await refreshPanelData();
  panelStatus.textContent = "Intel gaming sostituita con la scansione più recente.";
}

function setActivePanelTab(name, { focus = false } = {}) {
  if (!panelOrder.includes(name)) return;
  activePanelTab = name;
  panelTitle.textContent = name.toLocaleUpperCase("it");
  panelTabs.forEach((tab) => {
    const active = tab.dataset.panelTab === name;
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus({ preventScroll: true });
  });
  panelSections.forEach((section) => {
    section.hidden = section.dataset.panelSection !== name;
  });
}

function openPanel(name = activePanelTab, { focus = true } = {}) {
  if (!panelOpen) panelReturnFocus = document.activeElement;
  panelOpen = true;
  setActivePanelTab(name);
  document.body.classList.add("codec-panels-open");
  panelHandle.setAttribute("aria-expanded", "true");
  panel.setAttribute("aria-hidden", "false");
  panel.inert = false;
  panelBackdrop.setAttribute("aria-hidden", "false");
  panelStatus.textContent = `${name.toLocaleUpperCase("it")} aperto.`;
  if (focus) {
    window.setTimeout(() => {
      const activeTab = panelTabs.find((tab) => tab.dataset.panelTab === name);
      activeTab?.focus({ preventScroll: true });
    }, reduceMotion.matches ? 0 : 310);
  }
  void refreshPanelData();
}

function closePanel({ restoreFocus = true } = {}) {
  if (!panelOpen) return;
  panelOpen = false;
  document.body.classList.remove("codec-panels-open");
  panelHandle.setAttribute("aria-expanded", "false");
  panel.setAttribute("aria-hidden", "true");
  panel.inert = true;
  panelBackdrop.setAttribute("aria-hidden", "true");
  panelStatus.textContent = "Pannelli nascosti.";
  if (restoreFocus) {
    const target = panelReturnFocus?.isConnected ? panelReturnFocus : panelHandle;
    window.setTimeout(() => target?.focus({ preventScroll: true }), reduceMotion.matches ? 0 : 310);
  }
}

function movePanelTab(direction) {
  const current = panelOrder.indexOf(activePanelTab);
  const next = current + direction;
  if (direction > 0 && next < panelOrder.length) {
    setActivePanelTab(panelOrder[next], { focus: true });
  } else if (direction < 0 && next >= 0) {
    setActivePanelTab(panelOrder[next], { focus: true });
  } else if (direction < 0 && current === 0) {
    closePanel();
  }
}

function bindPanelSwipe(surface, { edge = false } = {}) {
  let gesture = null;
  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (edge && panelOpen)) return;
    gesture = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      horizontal: null,
    };
    surface.setPointerCapture?.(event.pointerId);
  });
  surface.addEventListener("pointermove", (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (gesture.horizontal === null && Math.max(Math.abs(dx), Math.abs(dy)) > 9) {
      gesture.horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
    }
    if (gesture.horizontal) event.preventDefault();
  });
  const finish = (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const isSwipe = gesture.horizontal === true && Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy);
    surface.releasePointerCapture?.(event.pointerId);
    gesture = null;
    if (!isSwipe) return;
    suppressPanelClickUntil = Date.now() + 420;
    if (edge) {
      if (dx < 0) openPanel("intel");
      return;
    }
    if (dx < 0) movePanelTab(1);
    else closePanel();
  };
  surface.addEventListener("pointerup", finish);
  surface.addEventListener("pointercancel", () => {
    gesture = null;
  });
}

function registerCodecServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  serviceWorkerRegistrationPromise = navigator.serviceWorker
    .register(assetUrl("service-worker.js"))
    .catch(() => null);
}

function requestNotificationPermissionFromGesture() {
  if (
    notificationPermissionRequested ||
    !("Notification" in window) ||
    Notification.permission !== "default"
  ) {
    return;
  }

  notificationPermissionRequested = true;
  void Notification.requestPermission().catch(() => {});
}

async function showBriefingNotification(briefingId) {
  if (
    document.visibilityState !== "hidden" ||
    !("Notification" in window) ||
    Notification.permission !== "granted" ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  try {
    const registration =
      (await serviceWorkerRegistrationPromise) ||
      (await navigator.serviceWorker.ready);
    await registration.showNotification("Mei Ling — Codec", {
      body: "Miura, ho un nuovo briefing per te.",
      tag: "mei-ling-briefing",
      renotify: true,
      data: {
        briefingId,
        url: window.location.href,
      },
    });
  } catch {
    // Notifications are supplementary; the incoming Codec call remains active.
  }
}

function handleBriefingReady(event) {
  let payload = {};
  try {
    payload = JSON.parse(event.data || "{}");
  } catch {
    // A malformed event must not interrupt subsequent EventSource deliveries.
  }

  const briefingId = String(payload.id || "").trim();
  if (!briefingId) return;
  pendingBriefingId = briefingId;
  void showBriefingNotification(briefingId);

  if (
    runtimeReadiness.ready
    && !connected
    && !calling
    && document.visibilityState === "visible"
    && document.hasFocus()
  ) {
    triggerIncomingCall();
  }
}

function connectBriefingEvents() {
  if (!("EventSource" in window) || briefingEvents) return;
  briefingEvents = new EventSource(`/api/events?clientVersion=${encodeURIComponent(CLIENT_VERSION)}`);
  briefingEvents.addEventListener("briefing-ready", handleBriefingReady);
  briefingEvents.addEventListener("debrief-ready", () => {
    void refreshPanelData();
  });
  // EventSource owns its retry cycle. Do not close it on transient errors.
}

async function fetchNewestUnreadBriefing() {
  const response = await fetchWithTimeout(
    "/api/inbox?status=unread&limit=1",
    { headers: { Accept: "application/json" } },
    15_000,
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Briefing unavailable");
  return Array.isArray(payload.items) ? payload.items[0] || null : null;
}

async function markBriefingRead(briefingId) {
  if (!briefingId) return;
  const response = await fetchWithTimeout(
    `/api/inbox/${encodeURIComponent(briefingId)}/read`,
    { method: "POST" },
    15_000,
  );
  if (!response.ok) throw new Error("Briefing status unavailable");
}

async function prepareMicrophone() {
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  if (!canRecord) {
    localMicError = "unavailable";
    return false;
  }
  if (localMicBlocked) return false;
  if (hasUsableAudioTrack(microphoneStream)) return true;
  if (microphoneStream) releaseMicrophone();
  if (microphonePromise) return waitForMicrophone(microphonePromise);

  const generation = microphoneGeneration;
  microphonePromise = (async () => {
    let stream = null;
    let context = null;
    let source = null;
    const stopStream = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };
    const closeContext = () => {
      try {
        source?.disconnect?.();
      } catch {
        // A partially-created source may already be disconnected.
      }
      if (context && context.state !== "closed") context.close().catch(() => {});
      source = null;
      context = null;
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      if (!hasUsableAudioTrack(stream)) {
        throw new DOMException("No usable audio track", "NotReadableError");
      }
      if (generation !== microphoneGeneration) {
        stopStream();
        return false;
      }

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        stopStream();
        return false;
      }
      context = new AudioContext();
      await context.resume();
      if (context.state !== "running") {
        throw new DOMException("Audio input graph is suspended", "NotReadableError");
      }
      source = context.createMediaStreamSource(stream);
      const nextAnalyser = context.createAnalyser();
      nextAnalyser.fftSize = 1024;
      nextAnalyser.smoothingTimeConstant = 0.2;
      source.connect(nextAnalyser);
      if (generation !== microphoneGeneration) {
        closeContext();
        stopStream();
        return false;
      }

      microphoneStream = stream;
      audioContext = context;
      microphoneSource = source;
      analyser = nextAnalyser;
      const [track] = stream.getAudioTracks();
      track?.addEventListener("ended", () => {
        if (microphoneStream !== stream) return;
        localMicError = "unavailable";
        releaseMicrophone();
        if (connected) revealTextFallback("MICROFONO DISCONNESSO — PUOI SCRIVERE");
      }, { once: true });
      localMicBlocked = false;
      localMicError = "";
      localSttFailed = false;
      silentMicCycles = 0;
      return true;
    } catch (error) {
      closeContext();
      stopStream();
      if (generation === microphoneGeneration) {
        localMicError = classifyMicrophoneError(error);
        localMicBlocked = localMicError === "blocked";
      }
      return false;
    } finally {
      microphonePromise = null;
    }
  })();

  return waitForMicrophone(microphonePromise);
}
function clearLocalRetry() {
  window.clearTimeout(localRetryTimer);
  localRetryTimer = null;
}

function resetVoiceInputFailures() {
  clearLocalRetry();
  localMicBlocked = false;
  localSttFailed = false;
  localMicError = "";
  silentMicCycles = 0;
  recognitionBlocked = !SpeechRecognition;
}

function scheduleLocalRetry(message = "RIPROVO AD ASCOLTARTI…", delay = 700) {
  clearLocalRetry();
  if (!connected) return;
  showTranscript("CODEC", message, "MIC RETRY");
  localRetryTimer = window.setTimeout(() => {
    localRetryTimer = null;
    localSttFailed = false;
    if (localMicError === "retryable") localMicError = "";
    if (connected) void startListening();
  }, delay);
}


function stopLocalListening({ discard = true } = {}) {
  window.clearInterval(vadTimer);
  vadTimer = null;
  if (!localListening) return;
  discardRecording = discard;
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
  } else {
    localListening = false;
  }
}

function releaseMicrophone() {
  clearLocalRetry();
  microphoneGeneration += 1;
  stopLocalListening({ discard: true });
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  try {
    microphoneSource?.disconnect?.();
  } catch {
    // The source may already have been disconnected while the page was closing.
  }
  microphoneSource = null;
  analyser = null;
  if (audioContext && audioContext.state !== "closed") audioContext.close().catch(() => {});
  audioContext = null;
}

async function transcribeAudio(blob) {
  if (!connected || busy || !blob.size) return;
  const epoch = callEpoch;
  busy = true;
  setComposerBusy(true);
  setState("thinking", "TRANSCRIBING");
  showTranscript("MIURA", "TRASCRIZIONE…", "TRANSCRIBING");

  try {
    const response = await fetchWithTimeout("/api/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "audio/webm",
        "X-Mei-Language": recognitionLanguage.toLowerCase().startsWith("en") ? "en" : "it",
        "X-Mei-Client-Version": CLIENT_VERSION,
      },
      body: blob,
    }, 28_000);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Local hearing unavailable");
    if (!connected || epoch !== callEpoch) return;
    const message = String(payload.text || "").trim();
    localSttFailed = false;
    busy = false;
    setComposerBusy(false);
    if (!message || isKnownPhantomInput(message) || isLowInformationVoiceInput(message)) {
      scheduleLocalRetry("NON HO RICEVUTO PAROLE — RIPROVO", 450);
      return;
    }
    setConversationLanguage(payload.language || detectLanguage(message));
    sendMessage(message, { inputMode: "voice-local" });
  } catch (error) {
    busy = false;
    setComposerBusy(false);
    if (!connected || epoch !== callEpoch || error.name === "AbortError") return;
    scheduleLocalRetry("RIPRISTINO ASCOLTO LOCALE…", 700);
  }
}
async function startLocalListening() {
  const epoch = callEpoch;
  if (localSttFailed || localListening || !connected || busy || callIntroPending || codec.dataset.state === "speaking") return false;
  try {
    if (!hasUsableAudioTrack(microphoneStream)) {
      showTranscript("CODEC", "CONSENTI L’ACCESSO AL MICROFONO", "MIC ACCESS");
    }
    if (!(await prepareMicrophone())) return false;
    if (!connected || epoch !== callEpoch || busy || callIntroPending || codec.dataset.state === "speaking" || !analyser || !hasUsableAudioTrack(microphoneStream)) return false;

    await audioContext?.resume();
    if (audioContext?.state !== "running") {
      throw new DOMException("Audio input graph is suspended", "NotReadableError");
    }
    if (!connected || epoch !== callEpoch || busy || callIntroPending || codec.dataset.state === "speaking") return false;
    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    const chunks = [];
    const recordingStartedAt = Date.now();
    const turnDetector = createPauseAwareTurnDetector(recordingStartedAt);
    discardRecording = false;
    const recorderEpoch = callEpoch;
    const recorder = new MediaRecorder(
      microphoneStream,
      mimeType ? { mimeType } : undefined,
    );
    mediaRecorder = recorder;
    localListening = true;
    let recorderFailed = false;

    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      window.clearInterval(vadTimer);
      vadTimer = null;
      localListening = false;
      const queuedRestart = listeningStartQueued;
      listeningStartQueued = false;
      const discarded = discardRecording;
      const heardSpeech = turnDetector.state().validSpeech;
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (mediaRecorder === recorder) mediaRecorder = null;
      if (recorderFailed) {
        scheduleLocalRetry("ERRORE MICROFONO — RIPROVO", 700);
        return;
      }

      const queuedVisibleRestart = Boolean(
        queuedRestart
        && recorderEpoch === callEpoch
        && connected
        && document.visibilityState === "visible"
        && !busy
        && !callIntroPending
        && codec.dataset.state !== "speaking"
      );
      const recorderRearm = shouldRearmLocalRecorder({
        discarded,
        recorderEpoch,
        callEpoch,
        connected,
        visible: document.visibilityState === "visible",
        busy,
        introPending: callIntroPending,
        speaking: codec.dataset.state === "speaking",
        ownsAudio: !voiceOwner || voiceOwner.isOwner(),
      });
      if (discarded || !connected) {
        if (queuedVisibleRestart || recorderRearm) {
          recognitionRestartTimer = window.setTimeout(startListening, 0);
        }
        return;
      }
      if (!heardSpeech || !blob.size) {
        silentMicCycles += 1;
        if (silentMicCycles >= 2) {
          revealTextFallback("MICROFONO SILENZIOSO — CONTROLLA IL DISPOSITIVO");
          return;
        }
        scheduleLocalRetry("NON SENTO LA TUA VOCE — RIPROVO", 650);
        return;
      }
      silentMicCycles = 0;
      void transcribeAudio(blob);
    };
    recorder.onerror = () => {
      recorderFailed = true;
      localSttFailed = true;
      discardRecording = true;
      showTranscript("CODEC", "ERRORE MICROFONO", "MIC RETRY");
      if (recorder.state === "recording") {
        try {
          recorder.stop();
        } catch {
          // The error may already have closed the recorder.
        }
      }
    };

    recorder.start(250);
    setState("listening");
    showTranscript("MIURA", "MICROFONO ATTIVO", "LOCAL MIC");
    let speechIndicatorShown = false;
    const samples = new Uint8Array(analyser.fftSize);
    vadTimer = window.setInterval(() => {
      if (!localListening || recorder.state !== "recording") return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        energy += normalized * normalized;
      }
      const rms = Math.sqrt(energy / samples.length);
      const turn = turnDetector.sample(rms, Date.now());
      if (turn.speechDetected && !speechIndicatorShown) {
        speechIndicatorShown = true;
        silentMicCycles = 0;
        showTranscript("MIURA", "VOCE RILEVATA", "RECORDING");
      }
      if (turn.shouldStop) stopLocalListening({ discard: false });
    }, 80);
    return true;
  } catch (error) {
    window.clearInterval(vadTimer);
    vadTimer = null;
    localListening = false;
    mediaRecorder = null;
    localMicError = classifyMicrophoneError(error);
    localMicBlocked = localMicError === "blocked";
    localSttFailed = localMicError === "retryable";
    if (localSttFailed) {
      scheduleLocalRetry("ASCOLTO LOCALE IN RIPRISTINO…", 700);
    }
    return false;
  }
}
function stopRecognition() {
  stopLocalListening({ discard: true });
  listeningStartQueued = false;
  window.clearTimeout(recognitionRestartTimer);
  recognitionRestartTimer = null;
  const wasRecognitionActive = recognitionActive;
  recognitionActive = false;
  if (!recognition || !wasRecognitionActive) return;
  try {
    recognition.abort();
  } catch {
    // The browser may already be closing the recognition cycle.
  }
}

function stopSpeech() {
  speechEpoch += 1;
  const cancelCurrentSpeech = currentSpeechCancel;
  currentSpeechCancel = null;
  cancelCurrentSpeech?.();
  const utterance = currentSpeechUtterance;
  currentSpeechUtterance = null;
  if (utterance) {
    utterance.onstart = null;
    utterance.onend = null;
    utterance.onerror = null;
  }
  window.speechSynthesis?.cancel();
  speechFallbackActive = false;
  if (!currentSpeechAudio) return;
  const audio = currentSpeechAudio;
  const source = audio.src;
  currentSpeechAudio = null;
  audio.onplay = null;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  if (source.startsWith("blob:")) URL.revokeObjectURL(source);
}

function revealTextFallback(reason = "MICROFONO NON DISPONIBILE") {
  recognitionBlocked = true;
  syncCallControls();
  if (connected) {
    setState("connected", "TEXT LINK");
    showTranscript("CODEC", reason, "TEXT LINK");
    window.setTimeout(() => messageInput.focus({ preventScroll: true }), 80);
  }
}

function detectLanguage(text) {
  const value = ` ${text.toLocaleLowerCase()} `;
  const english = (value.match(/\b(the|and|you|your|this|that|with|what|how|let|we|is|are|game|content)\b/g) || []).length;
  const italian = (value.match(/\b(il|lo|la|gli|le|e|che|con|per|come|cosa|sono|sei|tu|noi|gioco|contenuti)\b/g) || []).length;
  return english > italian ? "en" : "it";
}

function setConversationLanguage(language) {
  recognitionLanguage = language === "en" ? "en-US" : "it-IT";
  if (recognition && !recognitionActive) recognition.lang = recognitionLanguage;
}

function canStartConnectedListening(epoch = callEpoch) {
  return Boolean(
    connected
    && epoch === callEpoch
    && !busy
    && !callIntroPending
    && codec.dataset.state !== "speaking"
    && !currentSpeechAudio
    && !speechFallbackActive
    && document.visibilityState === "visible"
    && !localListening,
  );
}

async function startListening() {
  if (localListening) {
    listeningStartQueued = true;
    return false;
  }
  if (listeningStartPromise) {
    listeningStartQueued = true;
    return listeningStartPromise;
  }

  const epoch = callEpoch;
  const attempt = (async () => {
    if (!canStartConnectedListening(epoch)) return false;
    const ownsAudio = await ensureVoiceOwnership("conversation-listen");
    if (!canStartConnectedListening(epoch) || (voiceOwner && !voiceOwner.isOwner())) {
      if (!connected && !calling && !incomingCall && !wakeArmed) {
        voiceOwner?.release("stale-conversation-listen");
      }
      return false;
    }
    if (!ownsAudio) {
      showTranscript("CODEC", "AUDIO ATTIVO IN UN’ALTRA SCHEDA", "AUDIO PAUSED");
      return false;
    }
    syncCallControls();

    if (!appConfig.publicDemo && !localSttFailed && await startLocalListening()) return true;
    if (localSttFailed || localMicError === "retryable") {
      if (!localRetryTimer) scheduleLocalRetry("ASCOLTO LOCALE IN RIPRISTINO…", 700);
      return false;
    }
    if (localMicBlocked) {
      revealTextFallback("ACCESSO AL MICROFONO NEGATO — PUOI SCRIVERE");
      return false;
    }
    if (localMicError === "unavailable") {
      revealTextFallback("MICROFONO NON DISPONIBILE — PUOI SCRIVERE");
      return false;
    }
    if (!canStartConnectedListening(epoch)) return false;
    if (!recognition || recognitionBlocked) {
      revealTextFallback("SCRIVIMI QUI, MIURA");
      return false;
    }
    if (recognitionActive) return true;

    recognition.lang = recognitionLanguage;
    recognitionActive = true;
    try {
      recognition.start();
      return true;
    } catch {
      recognitionActive = false;
      if (canStartConnectedListening(epoch)) {
        recognitionRestartTimer = window.setTimeout(startListening, 500);
      }
      return false;
    }
  })();

  listeningStartPromise = attempt;
  try {
    return await attempt;
  } finally {
    if (listeningStartPromise === attempt) listeningStartPromise = null;
    const retryQueued = listeningStartQueued;
    listeningStartQueued = false;
    if (retryQueued && canStartConnectedListening()) {
      recognitionRestartTimer = window.setTimeout(startListening, 0);
    }
  }
}

function finishSpeechCycle() {
  if (!connected) return;
  setState("connected");
  window.clearTimeout(recognitionRestartTimer);
  recognitionRestartTimer = window.setTimeout(startListening, LISTEN_AFTER_SPEECH_MS);
}

function speakFallback(text, language, epoch = callEpoch) {
  if (!connected || epoch !== callEpoch) return;
  if (!("speechSynthesis" in window)) {
    revealTextFallback("VOCE NON DISPONIBILE — PUOI SCRIVERE");
    return;
  }

  speechFallbackActive = true;
  const utterance = new SpeechSynthesisUtterance(text);
  currentSpeechUtterance = utterance;
  utterance.lang = language === "en" ? "en-US" : "it-IT";
  utterance.rate = 0.92;
  utterance.pitch = 1.04;
  const voices = window.speechSynthesis.getVoices();
  const preferredVoiceNames = language === "en"
    ? /aria|jenny|samantha|zira|serena|sonia|female|google uk english female/i
    : /elsa|isabella|cosima|female|google italiano/i;
  utterance.voice = voices.find((voice) => (
    voice.lang.toLowerCase().startsWith(language) && preferredVoiceNames.test(voice.name)
  )) || voices.find((voice) => voice.lang.toLowerCase().startsWith(language)) || null;
  utterance.onstart = () => {
    if (currentSpeechUtterance !== utterance) return;
    if (!connected || epoch !== callEpoch) {
      stopSpeech();
      return;
    }
    setState("speaking");
  };
  utterance.onend = () => {
    if (currentSpeechUtterance !== utterance) return;
    currentSpeechUtterance = null;
    speechFallbackActive = false;
    if (connected && epoch === callEpoch) finishSpeechCycle();
  };
  utterance.onerror = () => {
    if (currentSpeechUtterance !== utterance) return;
    currentSpeechUtterance = null;
    speechFallbackActive = false;
    if (connected && epoch === callEpoch) {
      revealTextFallback("VOCE NON DISPONIBILE — PUOI SCRIVERE");
    }
  };
  window.speechSynthesis.speak(utterance);
}

async function speak(text, language = detectLanguage(text)) {
  if (!connected) return;
  if (!(await ensureVoiceOwnership("conversation-speak"))) {
    setState("connected", "AUDIO IN ALTRA SCHEDA");
    return;
  }
  const epoch = callEpoch;
  let audio = null;
  let source = "";
  let sourceRevoked = false;
  let fallbackStarted = false;
  const revokeSource = () => {
    if (!source || sourceRevoked) return;
    sourceRevoked = true;
    URL.revokeObjectURL(source);
  };
  const fallbackOnce = () => {
    if (
      fallbackStarted
      || !connected
      || epoch !== callEpoch
      || (audio && currentSpeechAudio !== audio)
    ) return;
    fallbackStarted = true;
    if (audio) {
      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;
      if (currentSpeechAudio === audio) currentSpeechAudio = null;
      audio.pause();
    }
    revokeSource();
    speakFallback(text, language, epoch);
  };
  stopRecognition();
  stopSpeech();
  setConversationLanguage(language);
  setState("speaking", "VOICE SYNC");

  try {
    const response = await fetchWithTimeout("/api/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mei-Client-Version": CLIENT_VERSION,
      },
      body: JSON.stringify({ text, language }),
    }, 25_000);
    if (!response.ok) throw new Error("Natural voice unavailable");
    if (!connected || epoch !== callEpoch) return;

    source = URL.createObjectURL(await response.blob());
    audio = new Audio(source);
    currentSpeechAudio = audio;
    audio.onplay = () => {
      if (currentSpeechAudio === audio && connected && epoch === callEpoch) {
        setState("speaking");
      }
    };
    audio.onended = () => {
      if (currentSpeechAudio === audio) currentSpeechAudio = null;
      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;
      revokeSource();
      if (connected && epoch === callEpoch) finishSpeechCycle();
    };
    audio.onerror = fallbackOnce;
    await audio.play();
  } catch (error) {
    if (!connected || epoch !== callEpoch || error.name === "AbortError") return;
    fallbackOnce();
  }
}
async function sendMessage(message, { inputMode = "text" } = {}) {
  const clean = message.trim();
  if (!clean || busy || callIntroPending || !connected) return;
  const canonicalInputMode = inputModes.has(inputMode) ? inputMode : "text";
  const epoch = callEpoch;
  rememberCallTurn("user", clean);

  busy = true;
  setComposerBusy(true);
  stopRecognition();
  setState("thinking");
  showTranscript("MIURA", clean, "PROCESSING");

  try {
    let payload;
    if (appConfig.clientAI) {
      const { askMei } = await import("./firebase-ai-client.js?v=23");
      payload = await askMei({
        message: clean,
        history: currentCallTranscript.slice(0, -1).map(({ role, content }) => ({ role, content })),
      });
    } else {
      const response = await fetchWithTimeout("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: clean,
          inputMode: canonicalInputMode,
          clientVersion: CLIENT_VERSION,
          history: appConfig.publicDemo
            ? currentCallTranscript.slice(0, -1).map(({ role, content }) => ({ role, content }))
            : undefined,
        }),
      }, 45_000);
      payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Codec error");
    }
    if (!connected || epoch !== callEpoch) return;

    window.applyMeiReply(payload);
    const language = payload.language || detectLanguage(payload.reply);
    rememberCallTurn("assistant", payload.reply, {
      searchResults: payload.searchResults,
      searchEntryPointHtml: payload.searchEntryPointHtml,
    });
    scheduleLiveDebrief();
    const spokenReply = String(payload.spokenReply || payload.reply || "").trim();
    setConversationLanguage(language);
    showTranscript("MEI LING", payload.reply, "TRANSMITTING");
    await speakFast(spokenReply, language);
  } catch (error) {
    if (!connected || epoch !== callEpoch || error.name === "AbortError") return;
    setState("error");
    showTranscript("CODEC", error.message || "LA LINEA CODEC È CADUTA", "LINK LOST");
    syncCallControls();
  } finally {
    if (epoch === callEpoch) busy = false;
    setComposerBusy(false);
    syncCallControls();
    lastFinalTranscript = "";
    if (connected && !currentSpeechAudio && !speechFallbackActive && codec.dataset.state === "error") {
      recognitionRestartTimer = window.setTimeout(startListening, 900);
    }
  }
}
function setupRecognition() {
  if (!SpeechRecognition) return;
  recognition = new SpeechRecognition();
  recognition.lang = recognitionLanguage;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    recognitionActive = true;
    if (!canStartConnectedListening()) {
      try {
        recognition.abort();
      } catch {
        recognitionActive = false;
      }
      return;
    }
    setState("listening");
    showTranscript("MIURA", "MICROFONO BROWSER ATTIVO", "BROWSER MIC");
  };

  recognition.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const part = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalText += part;
      else interim += part;
    }

    const visible = (finalText || interim).trim();
    if (visible) {
      transcriptText.hidden = false;
      transcriptText.textContent = visible;
    }

    const cleanFinal = finalText.trim();
    if (cleanFinal && (isKnownPhantomInput(cleanFinal) || isLowInformationVoiceInput(cleanFinal))) {
      showTranscript("MIURA", "RIPROVO AD ASCOLTARTI…", "BROWSER RETRY");
      return;
    }
    if (cleanFinal && cleanFinal !== lastFinalTranscript) {
      lastFinalTranscript = cleanFinal;
      setConversationLanguage(detectLanguage(cleanFinal));
      sendMessage(cleanFinal, { inputMode: "voice-browser" });
    }
  };

  recognition.onerror = (event) => {
    recognitionActive = false;
    if (event.error === "aborted") return;
    if (event.error === "no-speech") {
      showTranscript("MIURA", "NESSUNA VOCE RILEVATA — RIPROVO", "BROWSER RETRY");
      return;
    }
    if (["not-allowed", "service-not-allowed", "audio-capture", "network"].includes(event.error)) {
      revealTextFallback(`MICROFONO: ${event.error.toUpperCase()}`);
      return;
    }
    showTranscript("CODEC", `MICROFONO: ${event.error.toUpperCase()}`, "MIC ERROR");
  };

  recognition.onend = () => {
    recognitionActive = false;
    if (!canStartConnectedListening() || recognitionBlocked) return;
    recognitionRestartTimer = window.setTimeout(startListening, 650);
  };
}

async function connectCall({ incoming = false } = {}) {
  const epoch = callEpoch;
  clearCallTimers();
  stopRing();
  calling = false;
  incomingCall = false;
  callIntroPending = true;
  connected = true;
  setState("connected");
  setMeiExpression("neutral");
  setComposerBusy(true);

  try {
    if (incoming) {
      try {
        const briefing = await fetchNewestUnreadBriefing();
        if (!connected || epoch !== callEpoch) return;

        const spokenSummary = String(briefing?.spokenSummary || "").trim();
        if (briefing?.id && spokenSummary) {
          rememberCallTurn("assistant", spokenSummary);
          showTranscript("MEI LING", spokenSummary, "BRIEFING");
          await speakFast(spokenSummary, detectLanguage(spokenSummary));
          if (!connected || epoch !== callEpoch) return;
          callIntroPending = false;
          setComposerBusy(false);
          try {
            await markBriefingRead(briefing.id);
            if (pendingBriefingId === String(briefing.id)) pendingBriefingId = null;
          } catch {
            // The briefing was delivered; a read-receipt failure must not cut it off.
          }
          return;
        }

        pendingBriefingId = null;
      } catch (error) {
        if (!connected || epoch !== callEpoch || error.name === "AbortError") return;
        // Keep the call usable if the proactive inbox is temporarily unavailable.
      }
    }

    const greeting = "Ci sono, Miura.";
    showTranscript("MEI LING", greeting, "LINK ACTIVE");
    await speakFast(greeting, "it");
  } finally {
    if (connected && epoch === callEpoch) {
      callIntroPending = false;
      setComposerBusy(false);
    }
  }
}

async function beginCall() {
  if (!runtimeReadiness.ready) {
    showRuntimeWarmupStatus();
    return;
  }
  resetCallTranscript();
  resetVoiceInputFailures();
  wakeEpoch += 1;
  wakeArmed = false;
  writeWakePreference(false);
  stopWakeListening({ discard: true });
  wakeTranscribing = false;
  callEpoch += 1;
  const epoch = callEpoch;
  callIntroPending = false;
  window.clearTimeout(transcriptHideTimer);
  calling = true;
  incomingCall = false;
  setState("calling");
  showTranscript("CODEC", "CONNESSIONE ALLA FREQUENZA DI MEI LING…", "CALLING");
  playReveal({ replayAnimation: true });

  const ownsAudio = appConfig.publicDemo || await ensureVoiceOwnership("begin-call");
  if (!calling || connected || epoch !== callEpoch) return;
  if (!ownsAudio) {
    calling = false;
    setState("idle", "AUDIO IN ALTRA SCHEDA");
    showTranscript("CODEC", "AUDIO ATTIVO IN UN’ALTRA SCHEDA", "AUDIO PAUSED");
    return;
  }
  if (!appConfig.publicDemo) void prepareMicrophone();
  startRing();
  callTimer = window.setTimeout(() => connectCall(), 2800);
}

async function requestCallDebrief(transcriptSnapshot) {
  if (appConfig.clientAI) {
    const { createDebrief } = await import("./firebase-ai-client.js?v=23");
    return createDebrief(transcriptSnapshot);
  }
  const response = await fetchWithTimeout("/api/debrief", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId,
      transcript: transcriptSnapshot,
    }),
  }, 75_000);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.item) {
    throw new Error(payload?.error || "Il debrief locale non è disponibile.");
  }
  return payload.item;
}

async function endConnectedCall() {
  if (!connected || endingCall) return;
  endingCall = true;
  syncCallControls();
  const transcriptSnapshot = currentCallTranscript.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  callEpoch += 1;
  connected = false;
  calling = false;
  incomingCall = false;
  callIntroPending = false;
  busy = false;
  clearCallTimers();
  stopRing();
  cancelActiveRequests();
  stopRecognition();
  stopSpeech();
  releaseMicrophone();
  voiceOwner?.release("call-ended");
  setComposerBusy(false);
  syncCallControls();

  codecDisconnect.pause();
  codecDisconnect.currentTime = 0;
  void codecDisconnect.play().catch(() => {});
  document.body.classList.add("codec-link-closing");
  codec.classList.add("is-closing");
  setState("closing");
  showTranscript("CODEC", "CHIUSURA DEL LINK…", "CLOSING");

  await new Promise((resolve) => {
    window.setTimeout(resolve, reduceMotion.matches ? 0 : 540);
  });
  document.body.classList.remove("codec-link-closing");
  codec.classList.remove("is-closing");
  setState("debriefing");
  showTranscript("MEI LING", "ESTRAGGO DECISIONI, IDEE E PROSSIMI PASSI…", "DEBRIEF");

  let item = null;
  try {
    item = await requestCallDebrief(transcriptSnapshot);
    latestDebrief = item;
    latestDebriefError = "";
  } catch (error) {
    latestDebriefError = error?.name === "AbortError"
      ? "Debrief interrotto. Puoi riprovare dalla prossima chiamata."
      : String(error?.message || "Il debrief locale non è riuscito.");
  } finally {
    resetCallTranscript();
    endingCall = false;
    busy = false;
    setState("idle");
    setMeiExpression("neutral");
    renderDebriefPanel();
    showTranscript(
      "CODEC",
      item
        ? appConfig.publicDemo
          ? "LINK CHIUSO — DEBRIEF TEMPORANEO PRONTO"
          : "LINK CHIUSO — DEBRIEF SALVATO"
        : "LINK CHIUSO — DEBRIEF NON SALVATO",
      "STANDBY",
    );
    hideTranscriptSoon(2200);
    openPanel("debrief");
  }
}

function hangUp(message = "CHIAMATA TERMINATA") {
  callEpoch += 1;
  connected = false;
  calling = false;
  incomingCall = false;
  callIntroPending = false;
  busy = false;
  clearCallTimers();
  stopRing();
  cancelActiveRequests();
  stopRecognition();
  stopSpeech();
  releaseMicrophone();
  voiceOwner?.release("call-ended");
  setComposerBusy(false);
  syncCallControls();
  document.body.classList.remove("codec-link-closing");
  codec.classList.remove("is-closing");
  resetCallTranscript();
  setState("idle");
  showTranscript("CODEC", message, "STANDBY");
  setMeiExpression("neutral");
  hideTranscriptSoon();
}

async function triggerIncomingCall() {
  if (!runtimeReadiness.ready) {
    showRuntimeWarmupStatus();
    return;
  }
  if (connected || calling || endingCall) return;
  const ownsAudio = await ensureVoiceOwnership("incoming-call");
  if (!ownsAudio || connected || calling || endingCall) return;
  resetVoiceInputFailures();
  resetCallTranscript();
  wakeEpoch += 1;
  wakeArmed = false;
  writeWakePreference(false);
  stopWakeListening({ discard: true });
  wakeTranscribing = false;
  releaseMicrophone();
  calling = true;
  incomingCall = true;
  callIntroPending = false;
  setState("incoming");
  showTranscript("MEI LING", "CHIAMATA CODEC IN ARRIVO…", "INCOMING");
  playReveal({ replayAnimation: true });
  startRing();
}

window.meiLingIncomingCall = triggerIncomingCall;

function handleCodecAction() {
  requestNotificationPermissionFromGesture();
  if (endingCall) return;
  if (!runtimeReadiness.ready) {
    showRuntimeWarmupStatus();
    return;
  }

  if (connected) {
    return;
  }
  if (incomingCall) {
    connectCall({ incoming: true });
    return;
  }
  if (calling) {
    hangUp("CHIAMATA ANNULLATA");
    return;
  }
  void beginCall();
}

codec.addEventListener("click", handleCodecAction);
codec.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  handleCodecAction();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message || busy || callIntroPending || !connected) return;
  messageInput.value = "";
  sendMessage(message, { inputMode: "text" });
});

hangupButton.addEventListener("click", () => {
  if (endingCall) return;
  if (connected) {
    void endConnectedCall();
    return;
  }
  if (incomingCall) {
    hangUp("CHIAMATA RIFIUTATA");
    return;
  }
  if (calling) hangUp("CHIAMATA ANNULLATA");
});

panelHandle.addEventListener("click", () => {
  if (Date.now() < suppressPanelClickUntil) return;
  openPanel(activePanelTab);
});

panelClose.addEventListener("click", () => closePanel());
panelBackdrop.addEventListener("click", () => closePanel());
panelRefresh.addEventListener("click", async () => {
  if (Date.now() < suppressPanelClickUntil) return;
  panelRefresh.disabled = true;
  try {
    if (activePanelTab === "intel") await refreshIntelNow();
    else await refreshPanelData({ announce: true });
  } catch (error) {
    panelStatus.textContent = String(error?.message || "Sincronizzazione non riuscita.");
  } finally {
    panelRefresh.disabled = false;
  }
});

panelTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    if (Date.now() < suppressPanelClickUntil) return;
    setActivePanelTab(tab.dataset.panelTab);
  });
  tab.addEventListener("keydown", (event) => {
    const current = panelOrder.indexOf(activePanelTab);
    let next = null;
    if (event.key === "ArrowRight") next = Math.min(panelOrder.length - 1, current + 1);
    if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = panelOrder.length - 1;
    if (next === null) return;
    event.preventDefault();
    setActivePanelTab(panelOrder[next], { focus: true });
  });
});

panel.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closePanel();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...panel.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])")]
    .filter((element) => !element.hidden && element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && panelOpen) {
    event.preventDefault();
    closePanel();
  }
});

document.addEventListener("visibilitychange", () => {
    wakeArmed = false;
    writeWakePreference(false);
  if (document.visibilityState === "hidden") {
    wakeEpoch += 1;
    stopRing();
    stopWakeListening({ discard: true });
    stopRecognition();
    stopSpeech();
    releaseMicrophone();
    voiceOwner?.release("hidden");
    syncWakeUi("off", "WAKE TAP");
    return;
  }
  if (connected) void startListening();
});
window.addEventListener("focus", () => {
  if (connected) void startListening();
});
window.addEventListener("pagehide", () => {
  window.clearTimeout(runtimeHealthTimer);
  runtimeHealthTimer = null;
  stopRing();
  stopWakeListening({ discard: true });
  voiceOwner?.destroy();
});

async function initializeCodec() {
  await loadAppConfig();
  bindPanelSwipe(panelHandle, { edge: true });
  bindPanelSwipe(panelSwipeGrip);
  panelSections.forEach((section) => bindPanelSwipe(section));
  renderPanels();
  renderCallHistory();
  syncCallControls();
  syncPortraitState(codec.dataset.state || "idle");
  renderRuntimeReadiness();
  void refreshRuntimeHealth();
  void refreshPanelData();

  updateClock();
  window.setInterval(updateClock, 15000);
  setupRecognition();
  playReveal();
  registerCodecServiceWorker();
  if (!appConfig.publicDemo) connectBriefingEvents();
}

function syncWakeUi(state, label) {
  if (!wakeToggle || !wakeToggleLabel) return;
  if (appConfig.publicDemo) {
    wakeToggle.hidden = true;
    wakeToggle.disabled = true;
    wakeToggle.setAttribute("aria-pressed", "false");
    return;
  }
  if (!runtimeReadiness.ready) {
    wakeToggle.hidden = false;
    wakeToggle.disabled = true;
    wakeToggle.setAttribute("aria-pressed", "false");
    wakeToggle.dataset.wakeState = "paused";
    wakeToggleLabel.textContent = "STARTING";
    wakeToggle.title = runtimeReadiness.message;
    return;
  }
  wakeToggle.disabled = false;
  const activeCall = connected || calling || incomingCall || endingCall;
  wakeToggle.hidden = activeCall;
  wakeToggle.setAttribute("aria-pressed", wakeArmed ? "true" : "false");
  wakeToggle.dataset.wakeState = state || (wakeArmed ? "paused" : "off");
  wakeToggleLabel.textContent = label || (wakeArmed ? "WAKE ARMED" : "WAKE TAP");
  wakeToggle.title = wakeArmed
    ? `In ascolto di: ${wakePhraseLabel}`
    : `Attiva “${wakePhraseLabel}”`;
}


function writeWakePreference(enabled) {
  try {
    window.localStorage.setItem(WAKE_PREFERENCE_KEY, enabled ? "true" : "false");
  } catch {
    // Wake remains usable for the current page even when storage is blocked.
  }
}

function canRunWakeListener() {
  return Boolean(
    wakeArmed
    && !connected
    && !calling
    && !incomingCall
    && !endingCall
    && document.visibilityState === "visible",
  );
}

async function ensureVoiceOwnership(reason = "voice") {
  if (appConfig.publicDemo) return true;
  if (!voiceOwner) {
    return document.visibilityState === "visible" && document.hasFocus();
  }
  if (voiceOwner.isOwner()) return true;
  return voiceOwner.claim(reason);
}

function stopWakeListening({ discard = true } = {}) {
  window.clearTimeout(wakeRestartTimer);
  wakeRestartTimer = null;
  window.clearInterval(wakeVadTimer);
  wakeVadTimer = null;
  wakeDiscardRecording = discard;
  if (wakeRecorder?.state === "recording") {
    try {
      wakeRecorder.stop();
    } catch {
      // The recorder may already be completing its final chunk.
    }
  }
  wakeListening = false;
}


async function activateCallFromWake() {
  if (!runtimeReadiness.ready) return;
  if (!canRunWakeListener() || connected || (voiceOwner && !voiceOwner.isOwner())) return;
  wakeEpoch += 1;
  wakeArmed = false;
  writeWakePreference(false);
  stopWakeListening({ discard: true });
  resetVoiceInputFailures();
  wakeTranscribing = false;
  resetCallTranscript();
  callEpoch += 1;
  const epoch = callEpoch;
  clearCallTimers();
  stopRing();
  calling = false;
  incomingCall = false;
  callIntroPending = true;
  connected = true;
  busy = false;
  setState("connected");
  setMeiExpression("neutral");
  setComposerBusy(true);
  playReveal({ replayAnimation: true });

  const acknowledgement = "Ci sono, Miura.";
  rememberCallTurn("assistant", acknowledgement);
  showTranscript("MEI LING", acknowledgement, "LINK ACTIVE");
  try {
    await speakFast(acknowledgement, "it");
  } finally {
    if (connected && epoch === callEpoch) {
      callIntroPending = false;
      setComposerBusy(false);
    }
  }
}

async function transcribeWakeAudio(blob, token) {
  if (!blob.size || token !== wakeEpoch || !canRunWakeListener() || (voiceOwner && !voiceOwner.isOwner())) {
    if (wakeArmed && token === wakeEpoch) disarmWake();
    return;
  }

  wakeTranscribing = true;
  syncWakeUi("hearing", "WAKE HEARING");
  try {
    const response = await fetchWithTimeout("/api/wake/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "audio/webm",
        "X-Mei-Language": "it",
        "X-Mei-Client-Version": CLIENT_VERSION,
      },
      body: blob,
    }, 8_000);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Wake hearing unavailable");
    if (token !== wakeEpoch || !canRunWakeListener() || (voiceOwner && !voiceOwner.isOwner())) return;

    const phrase = String(payload.text || "").trim();
    if (isMeiLingWakePhrase(phrase)) {
      await activateCallFromWake();
      return;
    }
  } catch (error) {
    if (error.name !== "AbortError" && canRunWakeListener()) {
      syncWakeUi("paused", "WAKE RETRY");
    }
  } finally {
    wakeTranscribing = false;
    if (!connected && token === wakeEpoch) disarmWake();
  }
}

async function startWakeListening() {
  if (!canRunWakeListener() || wakeStarting || wakeListening || wakeTranscribing) {
    syncWakeUi(wakeArmed ? "paused" : "off");
    return false;
  }
  const token = wakeEpoch;
  wakeStarting = true;
  let ownsAudio = false;
  try {
    ownsAudio = await ensureVoiceOwnership("wake");
  } catch {
    wakeStarting = false;
    return false;
  }
  if (!ownsAudio) {
    wakeStarting = false;
    syncWakeUi("paused", "WAKE OTHER TAB");
    return false;
  }
  if (token !== wakeEpoch || !canRunWakeListener() || (voiceOwner && !voiceOwner.isOwner())) {
    wakeStarting = false;
    return false;
  }

  try {
    if (!(await prepareMicrophone()) || token !== wakeEpoch || !canRunWakeListener() || !analyser || !microphoneStream?.active) {
      syncWakeUi("paused", localMicBlocked ? "WAKE BLOCKED" : "WAKE TAP");
      return false;
    }

    await audioContext?.resume();
    if (token !== wakeEpoch || !canRunWakeListener() || !microphoneStream?.active) return false;
    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    const chunks = [];
    let speechDetected = false;
    let candidateStartedAt = 0;
    let silenceStartedAt = 0;
    let noiseFloor = 0.004;
    const startedAt = Date.now();
    wakeDiscardRecording = false;
    wakeRecorder = new MediaRecorder(
      microphoneStream,
      mimeType ? { mimeType } : undefined,
    );
    wakeListening = true;

    wakeRecorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    wakeRecorder.onstop = () => {
      window.clearInterval(wakeVadTimer);
      wakeVadTimer = null;
      wakeListening = false;
      const discarded = wakeDiscardRecording;
      const heardSpeech = speechDetected;
      const blob = new Blob(chunks, {
        type: wakeRecorder?.mimeType || mimeType || "audio/webm",
      });
      wakeRecorder = null;
      if (discarded || token !== wakeEpoch || !canRunWakeListener()) return;
      if (!heardSpeech || !blob.size) {
        disarmWake();
        return;
      }
      void transcribeWakeAudio(blob, token);
    };

    wakeRecorder.start(250);
    syncWakeUi("armed", "WAKE ARMED");
    const samples = new Uint8Array(analyser.fftSize);
    wakeVadTimer = window.setInterval(() => {
      if (!wakeListening || wakeRecorder?.state !== "recording") return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        energy += normalized * normalized;
      }
      const rms = Math.sqrt(energy / samples.length);
      const threshold = Math.max(0.008, Math.min(0.025, noiseFloor * 2.6));
      const now = Date.now();

      if (!speechDetected && !candidateStartedAt && rms < threshold * 1.2) {
        noiseFloor = (noiseFloor * 0.94) + (rms * 0.06);
      }
      if (!speechDetected) {
        if (rms > threshold) {
          if (!candidateStartedAt) candidateStartedAt = now;
          if (now - candidateStartedAt >= 160) {
            speechDetected = true;
            silenceStartedAt = 0;
          }
        } else if (rms < threshold * 0.84) {
          candidateStartedAt = 0;
        }
      } else if (rms > threshold * 1.02) {
        silenceStartedAt = 0;
      } else {
        if (!silenceStartedAt) silenceStartedAt = now;
        if (now - silenceStartedAt >= 520) {
          stopWakeListening({ discard: false });
        }
      }

      if (!speechDetected && now - startedAt >= 6_000) {
        stopWakeListening({ discard: false });
      } else if (now - startedAt >= 9_000) {
        stopWakeListening({ discard: false });
      }
    }, 80);
    return true;
  } catch {
    disarmWake();
    return false;
  } finally {
    wakeStarting = false;
  }
}

async function armWakeFromGesture() {
  if (!runtimeReadiness.ready) {
    showRuntimeWarmupStatus();
    return;
  }
  wakeArmed = true;
  wakeEpoch += 1;
  writeWakePreference(false);
  const token = wakeEpoch;
  syncWakeUi("paused", "WAKE ARMING");
  const started = await startWakeListening().catch(() => false);
  if (!started && wakeArmed && token === wakeEpoch) disarmWake();
}

function disarmWake() {
  wakeArmed = false;
  wakeEpoch += 1;
  wakeTranscribing = false;
  writeWakePreference(false);
  stopWakeListening({ discard: true });
  if (!connected) {
    releaseMicrophone();
    voiceOwner?.release("wake-disabled");
  }
  syncWakeUi("off", "WAKE TAP");
}

function resetWakeListenerOnLoad() {
  wakeArmed = false;
  writeWakePreference(false);
  syncWakeUi("off", "WAKE TAP");
}

const voiceOwner = window.MeiVoiceOwner?.create({
  autoClaimOnFocus: false,
  onLost: () => {
    callIntroPending = false;
    setComposerBusy(false);
    stopLocalListening({ discard: true });
    stopWakeListening({ discard: true });
    stopRecognition();
    stopSpeech();
    wakeArmed = false;
    writeWakePreference(false);
    wakeEpoch += 1;
    wakeTranscribing = false;
    releaseMicrophone();
    if (connected) {
      setState("connected", "AUDIO IN ALTRA SCHEDA");
      showTranscript("CODEC", "AUDIO ATTIVO IN UN’ALTRA SCHEDA", "AUDIO PAUSED");
    } else {
      syncWakeUi("off", "WAKE TAP");
    }
  },
}) || null;

wakeToggle?.addEventListener("click", () => {
  if (wakeArmed) {
    disarmWake();
    return;
  }
  void armWakeFromGesture();
});

resetWakeListenerOnLoad();

function splitSpeechIntoChunks(value, maxWords = 22) {
  const sentences = String(value || "")
    .match(/[^.!?…]+[.!?…]+|[^.!?…]+$/gu) || [];
  const chunks = [];
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/u).filter(Boolean);
    if (words.length <= maxWords) {
      if (words.length) chunks.push(words.join(" "));
      continue;
    }
    for (let index = 0; index < words.length; index += maxWords) {
      const part = words.slice(index, index + maxWords).join(" ");
      if (part) chunks.push(part);
    }
  }
  return chunks;
}

function disposePreparedSpeech(prepared) {
  if (!prepared || prepared.disposed) return;
  prepared.disposed = true;
  prepared.audio.onplay = null;
  prepared.audio.onended = null;
  prepared.audio.onerror = null;
  prepared.audio.pause();
  URL.revokeObjectURL(prepared.source);
  if (currentSpeechAudio === prepared.audio) currentSpeechAudio = null;
}

function staleSpeechError() {
  const error = new Error("Speech cycle superseded");
  error.name = "AbortError";
  return error;
}

async function requestNaturalSpeechChunk(text, language, epoch, cycle) {
  const response = await fetchWithTimeout("/api/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mei-Client-Version": CLIENT_VERSION,
    },
    body: JSON.stringify({ text, language }),
  }, 20_000);
  if (!response.ok) throw new Error("Natural voice unavailable");
  if (!connected || epoch !== callEpoch || cycle !== speechEpoch || (voiceOwner && !voiceOwner.isOwner())) {
    throw staleSpeechError();
  }

  const source = URL.createObjectURL(await response.blob());
  return {
    audio: new Audio(source),
    source,
    disposed: false,
  };
}

function playPreparedSpeech(prepared, epoch, cycle) {
  return new Promise((resolve, reject) => {
    const { audio } = prepared;
    let settled = false;
    const finish = (played, error = null) => {
      if (settled) return;
      settled = true;
      if (currentSpeechCancel === cancelPlayback) currentSpeechCancel = null;
      disposePreparedSpeech(prepared);
      if (error) reject(error);
      else resolve(played);
    };
    const cancelPlayback = () => finish(false);

    if (!connected || epoch !== callEpoch || cycle !== speechEpoch || (voiceOwner && !voiceOwner.isOwner())) {
      finish(false);
      return;
    }

    currentSpeechAudio = audio;
    currentSpeechCancel = cancelPlayback;
    audio.onplay = () => {
      if (currentSpeechAudio === audio && cycle === speechEpoch) setState("speaking");
    };
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false, new Error("Natural voice playback failed"));
    audio.play().catch((error) => finish(false, error));
  });
}

function settleSpeechRequest(promise) {
  return promise.then(
    (prepared) => ({ prepared, error: null }),
    (error) => ({ prepared: null, error }),
  );
}

async function speakFast(text, language = detectLanguage(text)) {
  if (appConfig.publicDemo) {
    if (!connected) return false;
    stopRecognition();
    stopSpeech();
    setConversationLanguage(language);
    speakFallback(text, language, callEpoch);
    return true;
  }
  const chunks = splitSpeechIntoChunks(text);
  if (!connected || !chunks.length) return;
  if (!(await ensureVoiceOwnership("conversation-speak"))) {
    setState("connected", "AUDIO IN ALTRA SCHEDA");
    return;
  }

  const epoch = callEpoch;
  stopRecognition();
  stopSpeech();
  const cycle = speechEpoch;
  setConversationLanguage(language);
  setState("speaking", "VOICE SYNC");

  let pending = settleSpeechRequest(
    requestNaturalSpeechChunk(chunks[0], language, epoch, cycle),
  );
  for (let index = 0; index < chunks.length; index += 1) {
    const result = await pending;
    if (result.error || !result.prepared) {
      if (
        result.error?.name !== "AbortError"
        && connected
        && epoch === callEpoch
        && cycle === speechEpoch
      ) {
        stopSpeech();
        speakFallback(chunks.slice(index).join(" "), language, epoch);
      }
      return;
    }

    const next = index + 1 < chunks.length
      ? settleSpeechRequest(
          requestNaturalSpeechChunk(chunks[index + 1], language, epoch, cycle),
        )
      : null;
    try {
      const played = await playPreparedSpeech(result.prepared, epoch, cycle);
      if (!played) {
        if (next) {
          void next.then(({ prepared }) => disposePreparedSpeech(prepared));
        }
        return;
      }
    } catch {
      if (next) {
        void next.then(({ prepared }) => disposePreparedSpeech(prepared));
      }
      if (connected && epoch === callEpoch && cycle === speechEpoch) {
        stopSpeech();
        speakFallback(chunks.slice(index).join(" "), language, epoch);
      }
      return;
    }
    pending = next;
  }

  if (connected && epoch === callEpoch && cycle === speechEpoch) {
    finishSpeechCycle();
  }
}

void initializeCodec();
