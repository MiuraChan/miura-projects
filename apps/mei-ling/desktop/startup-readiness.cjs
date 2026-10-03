const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 1_500;
const DEFAULT_POLL_INTERVAL_MS = 150;
const DEFAULT_VOICE_DEADLINE_MS = 15_000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForHttpServer(url, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleepImpl = sleep,
} = {}) {
  const startedAt = now();
  let lastError = "server not ready";

  while (now() - startedAt < timeoutMs) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await sleepImpl(pollIntervalMs);
  }

  throw new Error(`MEI interface timeout: ${lastError}`);
}

function createStagedRuntimeStartup({
  waitForVoice,
  launchDeferred,
  isCancelled = () => false,
  onError = () => {},
  voiceDeadlineMs = DEFAULT_VOICE_DEADLINE_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  if (typeof waitForVoice !== "function") {
    throw new TypeError("waitForVoice must be a function");
  }
  if (typeof launchDeferred !== "function") {
    throw new TypeError("launchDeferred must be a function");
  }
  if (!Number.isFinite(voiceDeadlineMs) || voiceDeadlineMs < 0) {
    throw new TypeError("voiceDeadlineMs must be a non-negative finite number");
  }

  let startPromise = null;
  let phase = "idle";
  let launched = false;

  function start() {
    if (startPromise) return startPromise;
    phase = "waiting-for-voice";
    let deadlineTimer;
    const voiceAttempt = Promise.resolve()
      .then(waitForVoice)
      .then(
        () => ({ voiceReady: true, reason: "voice-ready" }),
        (error) => ({ voiceReady: false, reason: "voice-error", error }),
      );
    const voiceDeadline = new Promise((resolve) => {
      deadlineTimer = setTimeoutImpl(() => {
        const error = new Error(
          `Voice startup deadline exceeded after ${voiceDeadlineMs}ms`,
        );
        resolve({ voiceReady: false, reason: "deadline", error });
      }, voiceDeadlineMs);
    });

    startPromise = Promise.race([voiceAttempt, voiceDeadline])
      .then(async (voiceState) => {
        if (voiceState.reason !== "deadline") clearTimeoutImpl(deadlineTimer);
        if (isCancelled()) {
          phase = "cancelled";
          return { launched: false, cancelled: true };
        }
        if (!voiceState.voiceReady) onError(voiceState.error);
        phase = "launching-deferred";
        if (!launched) {
          launched = true;
          await launchDeferred(voiceState);
        }
        phase = "ready";
        return { launched: true, cancelled: false };
      })
      .catch((error) => {
        phase = isCancelled() ? "cancelled" : "failed";
        onError(error);
        return {
          launched: false,
          cancelled: phase === "cancelled",
          error,
        };
      });
    return startPromise;
  }

  function status() {
    return { phase, launched };
  }

  return { start, status };
}

module.exports = { createStagedRuntimeStartup, waitForHttpServer };
