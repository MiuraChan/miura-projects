import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyMicrophoneError,
  hasUsableAudioTrack,
  shouldRearmLocalRecorder,
} from "../public/voice-input.js";

test("classifies microphone permission and device errors", () => {
  assert.equal(classifyMicrophoneError({ name: "NotAllowedError" }), "blocked");
  assert.equal(classifyMicrophoneError({ name: "SecurityError" }), "blocked");
  assert.equal(classifyMicrophoneError({ name: "NotFoundError" }), "unavailable");
  assert.equal(classifyMicrophoneError({ name: "NotSupportedError" }), "unavailable");
  assert.equal(classifyMicrophoneError({ name: "NotReadableError" }), "retryable");
});

test("requires a live enabled and unmuted audio track", () => {
  const stream = (track, active = true) => ({
    active,
    getAudioTracks: () => track ? [track] : [],
  });
  assert.equal(hasUsableAudioTrack(stream({ enabled: true, muted: false, readyState: "live" })), true);
  assert.equal(hasUsableAudioTrack(stream({ enabled: false, muted: false, readyState: "live" })), false);
  assert.equal(hasUsableAudioTrack(stream({ enabled: true, muted: true, readyState: "live" })), false);
  assert.equal(hasUsableAudioTrack(stream({ enabled: true, muted: false, readyState: "ended" })), false);
  assert.equal(hasUsableAudioTrack(stream(null)), false);
  assert.equal(hasUsableAudioTrack(stream({ enabled: true, muted: false, readyState: "live" }, false)), false);
});

test("rearms only a discarded recorder from the active visible call", () => {
  const healthy = {
    discarded: true,
    recorderEpoch: 4,
    callEpoch: 4,
    connected: true,
    visible: true,
    busy: false,
    introPending: false,
    speaking: false,
    ownsAudio: true,
  };
  assert.equal(shouldRearmLocalRecorder(healthy), true);
  for (const key of ["discarded", "connected", "visible", "ownsAudio"]) {
    assert.equal(shouldRearmLocalRecorder({ ...healthy, [key]: false }), false);
  }
  for (const key of ["busy", "introPending", "speaking"]) {
    assert.equal(shouldRearmLocalRecorder({ ...healthy, [key]: true }), false);
  }
  assert.equal(shouldRearmLocalRecorder({ ...healthy, recorderEpoch: 3 }), false);
});
