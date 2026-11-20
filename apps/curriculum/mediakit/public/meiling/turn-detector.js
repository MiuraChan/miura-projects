const DEFAULT_CONFIG = Object.freeze({
  calibrationMs: 240,
  speechStartMs: 160,
  // Preserve a natural one-second breathing pause without making every
  // completed turn wait an extra second and a half before transcription.
  endSilenceMs: 1_350,
  noSpeechMs: 5_000,
  maxUtteranceMs: 30_000,
  sampleMs: 80,
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function createPauseAwareTurnDetector(startedAt = 0, overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  let noiseFloor = 0.004;
  let speechCandidateStartedAt = 0;
  let silenceStartedAt = 0;
  let speechDetected = false;
  let voicedMs = 0;
  let peakRms = 0;
  let lastSampleAt = startedAt;
  let speechThreshold = 0.006;
  let releaseThreshold = 0.006;

  return {
    sample(rmsValue, nowValue) {
      const rms = Math.max(0, Number(rmsValue) || 0);
      const now = Math.max(lastSampleAt, Number(nowValue) || 0);
      const elapsed = now - startedAt;
      const sampleDuration = clamp(now - lastSampleAt || config.sampleMs, 0, config.sampleMs * 2);
      lastSampleAt = now;
      peakRms = Math.max(peakRms, rms);

      if (elapsed < config.calibrationMs) {
        // Only learn genuinely quiet samples so a soft first word is not
        // mistaken for the room and pushed below an ever-rising threshold.
        const calibrationCeiling = Math.max(noiseFloor * 1.45, noiseFloor + 0.0015);
        if (rms <= calibrationCeiling) {
          noiseFloor = clamp((noiseFloor * 0.8) + (rms * 0.2), 0.0015, 0.02);
        }
        speechCandidateStartedAt = 0;
        return this.state();
      }

      const threshold = clamp((noiseFloor * 2.2) + 0.0015, 0.006, 0.035);
      const noiseLearningCeiling = Math.max(noiseFloor * 1.45, noiseFloor + 0.0015);
      if (!speechDetected && !speechCandidateStartedAt && rms <= noiseLearningCeiling) {
        noiseFloor = (noiseFloor * 0.94) + (rms * 0.06);
      }

      if (!speechDetected) {
        if (rms > threshold) {
          if (!speechCandidateStartedAt) speechCandidateStartedAt = now;
          if (now - speechCandidateStartedAt >= config.speechStartMs) {
            speechDetected = true;
            speechThreshold = threshold;
            releaseThreshold = Math.max(
              (noiseFloor * 1.6) + 0.001,
              speechThreshold * 1.05,
            );
            voicedMs = Math.max(config.speechStartMs, now - speechCandidateStartedAt);
            silenceStartedAt = 0;
          }
        } else if (rms < threshold * 0.82) {
          speechCandidateStartedAt = 0;
        }
      } else if (rms >= releaseThreshold) {
        voicedMs += sampleDuration;
        silenceStartedAt = 0;
      } else if (!silenceStartedAt) {
        silenceStartedAt = now;
      }

      return this.state(now);
    },

    state(nowValue = lastSampleAt) {
      const now = Number(nowValue) || lastSampleAt;
      const elapsed = now - startedAt;
      const silenceMs = silenceStartedAt ? now - silenceStartedAt : 0;
      const validSpeech = speechDetected
        && voicedMs >= config.speechStartMs
        && peakRms >= speechThreshold * 1.02;
      let stopReason = "";
      if (validSpeech && silenceMs >= config.endSilenceMs) stopReason = "end-silence";
      else if (!speechDetected && elapsed >= config.noSpeechMs) stopReason = "no-speech";
      else if (elapsed >= config.maxUtteranceMs) stopReason = "max-duration";

      return {
        speechDetected,
        validSpeech,
        shouldStop: Boolean(stopReason),
        stopReason,
        silenceMs,
        voicedMs,
        peakRms,
        threshold: speechThreshold,
        releaseThreshold,
      };
    },
  };
}

export function isLowInformationVoiceInput(value) {
  const normalized = String(value || "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!normalized) return true;

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  const fillerTokens = new Set(["e", "eh", "ah", "aah", "uh", "uhm", "hm", "hmm", "mh", "mmm"]);
  if (tokens.every((token) => fillerTokens.has(token))) return true;
  if (tokens.length === 1 && /^([aeiouhm])\1{3,}$/u.test(tokens[0])) return true;

  if (tokens.length >= 6) {
    const frequencies = new Map();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
    const dominantCount = Math.max(...frequencies.values());
    if (dominantCount / tokens.length >= 0.75 && frequencies.size <= Math.max(2, Math.floor(tokens.length * 0.2))) {
      return true;
    }
  }

  return false;
}

export { DEFAULT_CONFIG as pauseAwareTurnDefaults };
