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
