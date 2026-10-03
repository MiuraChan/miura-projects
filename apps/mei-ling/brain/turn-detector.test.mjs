import test from "node:test";
import assert from "node:assert/strict";

import {
  createPauseAwareTurnDetector,
  isLowInformationVoiceInput,
  pauseAwareTurnDefaults,
} from "../public/turn-detector.js";

function feed(detector, start, end, rms, step = 80) {
  let state;
  for (let now = start; now <= end; now += step) state = detector.sample(rms, now);
  return state;
}
test("detects a user who begins speaking during the short calibration window", () => {
  const detector = createPauseAwareTurnDetector(0);
  feed(detector, 0, 160, 0.035);
  const state = feed(detector, 240, 560, 0.035);
  assert.equal(state.speechDetected, true);
  assert.equal(state.validSpeech, true);
});

test("detects quiet speech instead of learning it as room noise", () => {
  const detector = createPauseAwareTurnDetector(0);
  feed(detector, 0, 240, 0.0025);
  const state = feed(detector, 320, 640, 0.010);
  assert.equal(state.speechDetected, true);
  assert.equal(state.validSpeech, true);
});

test("accepts a short yes or no burst", () => {
  const detector = createPauseAwareTurnDetector(0);
  feed(detector, 0, 240, 0.0025);
  const state = feed(detector, 320, 560, 0.018);
  assert.equal(state.speechDetected, true);
  assert.equal(state.validSpeech, true);
});

test("a steady fan does not hold the turn open after real speech", () => {
  const detector = createPauseAwareTurnDetector(0);
  feed(detector, 0, 560, 0.009);
  feed(detector, 640, 1_280, 0.030);
  const almost = feed(detector, 1_360, 2_880, 0.009);
  assert.equal(almost.shouldStop, false);
  const ended = detector.sample(0.009, 2_960);
  assert.equal(ended.shouldStop, true);
  assert.equal(ended.stopReason, "end-silence");
});


test("keeps the turn open through a natural 1.52 second breathing pause", () => {
  const detector = createPauseAwareTurnDetector(0);
  feed(detector, 0, 480, 0.003);
  feed(detector, 560, 1_200, 0.035);
  const pause = feed(detector, 1_280, 2_720, 0.003);
  assert.equal(pause.shouldStop, false);
  const resumed = feed(detector, 2_800, 3_360, 0.032);
  assert.equal(resumed.shouldStop, false);
  assert.equal(resumed.speechDetected, true);
});

test("ends a valid turn after 1.6 seconds of final silence", () => {
  const detector = createPauseAwareTurnDetector(0);
  feed(detector, 0, 480, 0.003);
  feed(detector, 560, 1_200, 0.035);
  const almost = feed(detector, 1_280, 2_800, 0.003);
  assert.equal(almost.shouldStop, false);
  const ended = detector.sample(0.003, 2_880);
  assert.equal(ended.shouldStop, true);
  assert.equal(ended.stopReason, "end-silence");
  assert.ok(ended.silenceMs >= pauseAwareTurnDefaults.endSilenceMs);
});

test("ignores ambient noise and exits the empty listening cycle at five seconds", () => {
  const detector = createPauseAwareTurnDetector(0);
  const state = feed(detector, 0, 5_040, 0.004);
  assert.equal(state.speechDetected, false);
  assert.equal(state.validSpeech, false);
  assert.equal(state.stopReason, "no-speech");
});

test("rejects repeated vowel hallucinations without rejecting useful short answers", () => {
  assert.equal(isLowInformationVoiceInput("e e e e e e e e e e e e"), true);
  assert.equal(isLowInformationVoiceInput("eeeeeeee"), true);
  assert.equal(isLowInformationVoiceInput("eh... eh... eh"), true);
  assert.equal(isLowInformationVoiceInput("Sì, sono pronto"), false);
  assert.equal(isLowInformationVoiceInput("No"), false);
  assert.equal(isLowInformationVoiceInput("E poi cosa facciamo?"), false);
});
