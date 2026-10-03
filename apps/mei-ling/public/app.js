const codec = document.querySelector(".codec");
const clock = document.querySelector("#clock");
const meiPortrait = document.querySelector(".portrait--mei");
const meiPortraitImage = document.querySelector("#meiPortraitImage");
const transcript = document.querySelector("#codecTranscript");
const transcriptSpeaker = document.querySelector("#transcriptSpeaker");
const transcriptText = document.querySelector("#transcriptText");
const callStatus = document.querySelector("#callStatus");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
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

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const sessionId = crypto.randomUUID?.() || `mei-${Date.now()}`;
const codecRing = new Audio("/audio/metal-gear-codec.mp3");
const codecDisconnect = new Audio("/audio/codec-disconnect.wav");
const activeRequests = new Set();
const panelOrder = Object.freeze(["intel", "debrief", "memory"]);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

codecRing.preload = "auto";
codecRing.volume = 0.78;
codecDisconnect.preload = "auto";
codecDisconnect.volume = 0.78;

const meiExpressions = Object.freeze({
  neutral: "/figma-mei-manga-approved.png",
  laughing: "/mei-expression-laughing-v1.png",
  serious: "/mei-expression-serious-v1.png",
  embarrassed: "/mei-expression-embarrassed-v1.png",
  angry: "/mei-expression-angry-v1.png",
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
let recognitionLanguage = "it-IT";
let recognitionRestartTimer = null;
let callTimer = null;
let revealTimer = null;
let transcriptHideTimer = null;
let currentSpeechAudio = null;
let speechFallbackActive = false;
let lastFinalTranscript = "";
let microphoneStream = null;
let microphonePromise = null;
let microphoneSource = null;
let mediaRecorder = null;
let audioContext = null;
let analyser = null;
let vadTimer = null;
let localListening = false;
let localMicBlocked = false;
let localSttFailed = false;
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
let panelData = {
  briefings: [],
  instructions: [],
  status: null,
  sources: [],
};

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

function setState(state, status = stateLabels[state]) {
  codec.dataset.state = state;
  callStatus.textContent = status || stateLabels[state] || "LINK ACTIVE";

  let actionLabel = "Chiama Mei Ling";
  if (endingCall || state === "closing" || state === "debriefing") {
    actionLabel = "Chiusura della chiamata in corso";
  } else if (incomingCall || state === "incoming") {
    actionLabel = "Rispondi alla chiamata di Mei Ling";
  } else if (connected) {
    actionLabel = "Termina la chiamata con Mei Ling";
  } else if (calling) {
    actionLabel = "Annulla la chiamata a Mei Ling";
  }

  codec.setAttribute("aria-label", actionLabel);
  codec.setAttribute("aria-disabled", endingCall ? "true" : "false");
}

function showTranscript(speaker, text, status) {
  window.clearTimeout(transcriptHideTimer);
  transcript.hidden = false;
  transcriptSpeaker.textContent = speaker;
  transcriptText.textContent = text;
  if (status) callStatus.textContent = status;
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
  codec.classList.add("is-ringing");
  codecRing.loop = true;
  codecRing.currentTime = 0;
  codecRing.play().catch(() => {
    showTranscript("CODEC", "AUDIO BLOCCATO DAL BROWSER", "AUDIO LOCKED");
  });
}

function stopRing() {
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

function rememberCallTurn(role, content) {
  if (role !== "user" && role !== "assistant") return;
  const clean = String(content || "").replace(/\s+/gu, " ").trim().slice(0, 6000);
  if (!clean) return;
  currentCallTranscript.push({ role, content: clean });
  if (currentCallTranscript.length > 80) {
    currentCallTranscript = currentCallTranscript.slice(-80);
  }
}

function resetCallTranscript() {
  currentCallTranscript = [];
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
      return `${source} — ${title}`;
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
    text: item.summary || item.spokenSummary || "Debrief salvato.",
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
      ["Salvato", formatPanelDate(item.createdAt)],
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
    .register("/service-worker.js")
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

  if (!connected && !calling) triggerIncomingCall();
}

function connectBriefingEvents() {
  if (!("EventSource" in window) || briefingEvents) return;
  briefingEvents = new EventSource("/api/events");
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
  if (!canRecord || localMicBlocked) return false;
  if (microphoneStream?.active) return true;
  if (microphonePromise) return waitForMicrophone(microphonePromise);

  microphonePromise = (async () => {
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      audioContext = new AudioContext();
      microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      microphoneSource.connect(analyser);
      return true;
    } catch {
      localMicBlocked = true;
      return false;
    } finally {
      microphonePromise = null;
    }
  })();

  return waitForMicrophone(microphonePromise);
}

function stopLocalListening({ discard = true } = {}) {
  window.clearInterval(vadTimer);
  vadTimer = null;
  if (!localListening) return;
  discardRecording = discard;
  localListening = false;
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
}

function releaseMicrophone() {
  stopLocalListening({ discard: true });
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  microphoneSource = null;
  analyser = null;
  if (audioContext && audioContext.state !== "closed") audioContext.close().catch(() => {});
  audioContext = null;
}

async function transcribeAudio(blob) {
  if (!connected || busy || !blob.size) return;
  const epoch = callEpoch;
  busy = true;
  setState("thinking", "HEARING");
  showTranscript("MIURA", "TRASCRIZIONE…", "HEARING");

  try {
    const response = await fetchWithTimeout("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/webm" },
      body: blob,
    }, 95_000);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Local hearing unavailable");
    if (!connected || epoch !== callEpoch) return;
    const message = String(payload.text || "").trim();
    busy = false;
    if (!message) {
      startListening();
      return;
    }
    setConversationLanguage(payload.language || detectLanguage(message));
    sendMessage(message);
  } catch (error) {
    busy = false;
    if (!connected || epoch !== callEpoch || error.name === "AbortError") return;
    localSttFailed = true;
    showTranscript("CODEC", "ASCOLTO LOCALE NON DISPONIBILE", "MIC FALLBACK");
    startListening();
  }
}
async function startLocalListening() {
  if (localSttFailed || localListening || !connected || busy) return false;
  try {
    if (!microphoneStream?.active) {
      showTranscript("CODEC", "CONSENTI L’ACCESSO AL MICROFONO", "MIC ACCESS");
    }
    if (!(await prepareMicrophone())) return false;
    if (!connected || busy || !analyser || !microphoneStream?.active) return false;

    await audioContext?.resume();
    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    const chunks = [];
    let speechDetected = false;
    let silenceStartedAt = 0;
    let noiseFloor = 0.004;
    const recordingStartedAt = Date.now();
    discardRecording = false;
    mediaRecorder = new MediaRecorder(
      microphoneStream,
      mimeType ? { mimeType } : undefined,
    );
    localListening = true;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    mediaRecorder.onstop = () => {
      window.clearInterval(vadTimer);
      vadTimer = null;
      localListening = false;
      const discarded = discardRecording;
      const heardSpeech = speechDetected;
      const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || mimeType || "audio/webm" });
      mediaRecorder = null;
      if (discarded || !connected) return;
      if (!heardSpeech || !blob.size) {
        recognitionRestartTimer = window.setTimeout(startListening, 420);
        return;
      }
      transcribeAudio(blob);
    };

    setState("listening");
    showTranscript("MIURA", "…", "LISTENING");
    mediaRecorder.start(250);
    const samples = new Uint8Array(analyser.fftSize);
    vadTimer = window.setInterval(() => {
      if (!localListening || mediaRecorder?.state !== "recording") return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        energy += normalized * normalized;
      }
      const rms = Math.sqrt(energy / samples.length);
      const threshold = Math.max(0.009, Math.min(0.03, noiseFloor * 2.8));
      const now = Date.now();
      if (!speechDetected && rms < threshold * 1.2) {
        noiseFloor = (noiseFloor * 0.94) + (rms * 0.06);
      }
      if (rms > threshold) {
        speechDetected = true;
        silenceStartedAt = 0;
      } else if (speechDetected) {
        if (!silenceStartedAt) silenceStartedAt = now;
        if (now - silenceStartedAt > 850 && now - recordingStartedAt > 650) {
          stopLocalListening({ discard: false });
        }
      } else if (now - recordingStartedAt > 10000) {
        stopLocalListening({ discard: false });
      }
      if (now - recordingStartedAt > 25000) stopLocalListening({ discard: false });
    }, 80);
    return true;
  } catch {
    window.clearInterval(vadTimer);
    vadTimer = null;
    localListening = false;
    mediaRecorder = null;
    localSttFailed = true;
    showTranscript("CODEC", "ASCOLTO LOCALE NON DISPONIBILE", "MIC FALLBACK");
    return false;
  }
}
function stopRecognition() {
  stopLocalListening({ discard: true });
  window.clearTimeout(recognitionRestartTimer);
  recognitionRestartTimer = null;
  if (!recognition || !recognitionActive) return;
  try {
    recognition.abort();
  } catch {
    // The browser may already be closing the recognition cycle.
  }
}

function stopSpeech() {
  window.speechSynthesis?.cancel();
  speechFallbackActive = false;
  if (!currentSpeechAudio) return;
  const source = currentSpeechAudio.src;
  currentSpeechAudio.pause();
  currentSpeechAudio = null;
  if (source.startsWith("blob:")) URL.revokeObjectURL(source);
}

function revealTextFallback(reason = "MICROFONO NON DISPONIBILE") {
  recognitionBlocked = true;
  messageForm.hidden = false;
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

async function startListening() {
  if (!connected || busy || currentSpeechAudio || speechFallbackActive || localListening) return;
  messageForm.hidden = true;

  if (!localSttFailed && await startLocalListening()) return;
  if (!recognition || recognitionBlocked) {
    revealTextFallback("SCRIVIMI QUI, MIURA");
    return;
  }
  if (recognitionActive) return;

  recognition.lang = recognitionLanguage;
  try {
    recognition.start();
  } catch {
    recognitionRestartTimer = window.setTimeout(startListening, 500);
  }
}

function finishSpeechCycle() {
  if (!connected) return;
  setState("connected");
  startListening();
}

function speakFallback(text, language) {
  if (!("speechSynthesis" in window)) {
    revealTextFallback("VOCE NON DISPONIBILE — PUOI SCRIVERE");
    return;
  }

  speechFallbackActive = true;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === "en" ? "en-US" : "it-IT";
  utterance.rate = 0.9;
  utterance.pitch = 1.08;
  const voices = window.speechSynthesis.getVoices();
  utterance.voice =
    voices.find((voice) => voice.lang.toLowerCase().startsWith(language) && /female|elsa|isabella|aria|samantha/i.test(voice.name)) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith(language)) ||
    null;
  utterance.onstart = () => setState("speaking");
  utterance.onend = () => {
    speechFallbackActive = false;
    finishSpeechCycle();
  };
  utterance.onerror = () => {
    speechFallbackActive = false;
    revealTextFallback("VOCE NON DISPONIBILE — PUOI SCRIVERE");
  };
  window.speechSynthesis.speak(utterance);
}

async function speak(text, language = detectLanguage(text)) {
  if (!connected) return;
  const epoch = callEpoch;
  stopRecognition();
  stopSpeech();
  setConversationLanguage(language);
  setState("speaking", "VOICE SYNC");
  showTranscript("MEI LING", text, "VOICE SYNC");

  try {
    const response = await fetchWithTimeout("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    }, 60_000);
    if (!response.ok) throw new Error("Natural voice unavailable");
    if (!connected || epoch !== callEpoch) return;

    const source = URL.createObjectURL(await response.blob());
    const audio = new Audio(source);
    currentSpeechAudio = audio;
    audio.onplay = () => setState("speaking");
    audio.onended = () => {
      if (currentSpeechAudio === audio) currentSpeechAudio = null;
      URL.revokeObjectURL(source);
      finishSpeechCycle();
    };
    audio.onerror = () => {
      if (currentSpeechAudio === audio) currentSpeechAudio = null;
      URL.revokeObjectURL(source);
      revealTextFallback("VOCE DI MEI LING NON DISPONIBILE");
    };
    await audio.play();
  } catch (error) {
    if (!connected || epoch !== callEpoch || error.name === "AbortError") return;
    stopSpeech();
    revealTextFallback("VOCE DI MEI LING NON DISPONIBILE");
  }
}
async function sendMessage(message) {
  const clean = message.trim();
  if (!clean || busy || !connected) return;
  const epoch = callEpoch;
  rememberCallTurn("user", clean);

  busy = true;
  stopRecognition();
  setState("thinking");
  showTranscript("MIURA", clean, "PROCESSING");

  try {
    const response = await fetchWithTimeout("/api/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: clean }),
    }, 95_000);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Codec error");
    if (!connected || epoch !== callEpoch) return;

    window.applyMeiReply(payload);
    const language = payload.language || detectLanguage(payload.reply);
    rememberCallTurn("assistant", payload.reply);
    setConversationLanguage(language);
    showTranscript("MEI LING", payload.reply, "TRANSMITTING");
    await speak(payload.reply, language);
  } catch (error) {
    if (!connected || epoch !== callEpoch || error.name === "AbortError") return;
    setState("error");
    showTranscript("CODEC", error.message || "LA LINEA CODEC È CADUTA", "LINK LOST");
    if (recognitionBlocked) messageForm.hidden = false;
  } finally {
    if (epoch === callEpoch) busy = false;
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
    if (!connected) return;
    setState("listening");
    showTranscript("MIURA", "…", "LISTENING");
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
      transcriptText.textContent = visible;
      messageInput.value = visible;
    }

    const cleanFinal = finalText.trim();
    if (cleanFinal && cleanFinal !== lastFinalTranscript) {
      lastFinalTranscript = cleanFinal;
      messageInput.value = "";
      sendMessage(cleanFinal);
    }
  };

  recognition.onerror = (event) => {
    recognitionActive = false;
    if (event.error === "aborted") return;
    if (event.error === "no-speech") {
      showTranscript("MIURA", "…", "LISTENING");
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
    if (!connected || busy || currentSpeechAudio || speechFallbackActive || recognitionBlocked) return;
    recognitionRestartTimer = window.setTimeout(startListening, 650);
  };
}

async function connectCall({ incoming = false } = {}) {
  const epoch = callEpoch;
  void prepareMicrophone();
  clearCallTimers();
  stopRing();
  calling = false;
  incomingCall = false;
  connected = true;
  setState("connected");
  setMeiExpression("neutral");

  if (incoming) {
    try {
      const briefing = await fetchNewestUnreadBriefing();
      if (!connected || epoch !== callEpoch) return;

      const spokenSummary = String(briefing?.spokenSummary || "").trim();
      if (briefing?.id && spokenSummary) {
        rememberCallTurn("assistant", spokenSummary);
        showTranscript("MEI LING", spokenSummary, "BRIEFING");
        await speak(spokenSummary, detectLanguage(spokenSummary));
        if (!connected || epoch !== callEpoch) return;
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

  const greeting = incoming
    ? "Miura… ti cercavo. Mi mancava la tua voce; ora dimmi, oggi creiamo o ti nascondi nel caos?"
    : "Miura… finalmente. Dimmi cosa stai preparando; sarò dolce, ma non ti lascerò perdere tempo.";
  rememberCallTurn("assistant", greeting);
  showTranscript("MEI LING", greeting, "LINK ACTIVE");
  await speak(greeting, "it");
}

function beginCall() {
  resetCallTranscript();
  callEpoch += 1;
  void prepareMicrophone();
  window.clearTimeout(transcriptHideTimer);
  calling = true;
  incomingCall = false;
  setState("calling");
  showTranscript("CODEC", "CONNESSIONE ALLA FREQUENZA DI MEI LING…", "CALLING");
  playReveal({ replayAnimation: true });
  startRing();
  callTimer = window.setTimeout(() => connectCall(), 2800);
}

async function requestCallDebrief(transcriptSnapshot) {
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
  const transcriptSnapshot = currentCallTranscript.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  callEpoch += 1;
  connected = false;
  calling = false;
  incomingCall = false;
  busy = false;
  clearCallTimers();
  stopRing();
  cancelActiveRequests();
  stopRecognition();
  stopSpeech();
  releaseMicrophone();
  messageForm.hidden = true;

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
      item ? "LINK CHIUSO — DEBRIEF SALVATO" : "LINK CHIUSO — DEBRIEF NON SALVATO",
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
  busy = false;
  clearCallTimers();
  stopRing();
  cancelActiveRequests();
  stopRecognition();
  stopSpeech();
  releaseMicrophone();
  messageForm.hidden = true;
  document.body.classList.remove("codec-link-closing");
  codec.classList.remove("is-closing");
  resetCallTranscript();
  setState("idle");
  showTranscript("CODEC", message, "STANDBY");
  setMeiExpression("neutral");
  hideTranscriptSoon();
}

function triggerIncomingCall() {
  if (connected || calling || endingCall) return;
  resetCallTranscript();
  calling = true;
  incomingCall = true;
  setState("incoming");
  showTranscript("MEI LING", "CHIAMATA CODEC IN ARRIVO…", "INCOMING");
  playReveal({ replayAnimation: true });
  startRing();
}

window.meiLingIncomingCall = triggerIncomingCall;

function handleCodecAction() {
  requestNotificationPermissionFromGesture();
  if (endingCall) return;

  if (connected) {
    void endConnectedCall();
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
  beginCall();
}

codec.addEventListener("click", handleCodecAction);
codec.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  handleCodecAction();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = messageInput.value;
  messageInput.value = "";
  sendMessage(message);
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
    await refreshPanelData({ announce: true });
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

bindPanelSwipe(panelHandle, { edge: true });
bindPanelSwipe(panelSwipeGrip);
panelSections.forEach((section) => bindPanelSwipe(section));
renderPanels();
void refreshPanelData();

updateClock();
window.setInterval(updateClock, 15000);
setupRecognition();
playReveal();
registerCodecServiceWorker();
connectBriefingEvents();