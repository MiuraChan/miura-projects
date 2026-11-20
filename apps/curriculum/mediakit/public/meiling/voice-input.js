const BLOCKED_MICROPHONE_ERRORS = new Set(["NotAllowedError", "SecurityError"]);
const UNAVAILABLE_MICROPHONE_ERRORS = new Set(["NotFoundError", "NotSupportedError"]);

export function classifyMicrophoneError(error) {
  const name = String(error?.name || "").trim();
  if (BLOCKED_MICROPHONE_ERRORS.has(name)) return "blocked";
  if (UNAVAILABLE_MICROPHONE_ERRORS.has(name)) return "unavailable";
  return "retryable";
}

export function hasUsableAudioTrack(stream) {
  if (!stream?.active || typeof stream.getAudioTracks !== "function") return false;
  const [track] = stream.getAudioTracks();
  return Boolean(track && track.enabled && track.readyState === "live" && !track.muted);
}

export function shouldRearmLocalRecorder({
  discarded,
  recorderEpoch,
  callEpoch,
  connected,
  visible,
  busy,
  introPending,
  speaking,
  ownsAudio,
}) {
  return Boolean(
    discarded
    && recorderEpoch === callEpoch
    && connected
    && visible
    && !busy
    && !introPending
    && !speaking
    && ownsAudio,
  );
}

export function shouldPreferBrowserRecognition({
  publicDemo,
  recognitionAvailable,
  recognitionBlocked,
}) {
  return Boolean(publicDemo && recognitionAvailable && !recognitionBlocked);
}

export function shouldRetryConversationListening({
  connected,
  sameCall,
  visible,
  started,
  attemptsRemaining,
}) {
  return Boolean(
    connected
    && sameCall
    && visible
    && !started
    && attemptsRemaining > 0,
  );
}

export function compactSpokenReply(value, fallback = "", {
  maxSentences = 2,
  maxWords = 36,
} = {}) {
  const source = String(value || fallback || "").replace(/\s+/gu, " ").trim();
  if (!source) return "";
  const sentences = source.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/gu) || [source];
  const selected = [];
  let wordCount = 0;
  for (const sentence of sentences.slice(0, Math.max(1, maxSentences))) {
    const words = sentence.trim().split(/\s+/u).filter(Boolean);
    if (!words.length) continue;
    if (selected.length && wordCount + words.length > maxWords) break;
    selected.push(...words);
    wordCount += words.length;
    if (wordCount >= maxWords) break;
  }
  if (!selected.length) return "";
  if (selected.length <= maxWords) {
    const compact = selected.join(" ");
    if (wordCount <= maxWords && compact === source) return compact;
    if (wordCount <= maxWords && /[.!?…]$/u.test(compact)) return compact;
  }
  return `${selected.slice(0, maxWords).join(" ").replace(/[,:;]$/u, "")}…`;
}
