import assert from "node:assert/strict";
import test from "node:test";
import startupReadiness from "../desktop/startup-readiness.cjs";

const {
  createStagedRuntimeStartup,
  waitForHttpServer,
} = startupReadiness;

test("desktop startup reveals the UI when the Codec HTTP server responds", async () => {
  let attempts = 0;
  const response = await waitForHttpServer("http://127.0.0.1:12345", {
    timeoutMs: 100,
    pollIntervalMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("not listening yet");
      return { ok: true, status: 200 };
    },
    sleepImpl: async () => {},
  });

  assert.equal(response.ok, true);
  assert.equal(attempts, 2);
});

test("desktop startup reports a focused interface timeout", async () => {
  let tick = 0;
  await assert.rejects(
    waitForHttpServer("http://127.0.0.1:12345", {
      timeoutMs: 3,
      fetchImpl: async () => ({ ok: false, status: 503 }),
      now: () => tick++,
      sleepImpl: async () => {},
    }),
    /MEI interface timeout: HTTP 503/u,
  );
});

test("staged startup leaves the UI path free while voice warms", async () => {
  let resolveVoice;
  let voiceWaits = 0;
  let deferredLaunches = 0;
  const voiceReady = new Promise((resolve) => {
    resolveVoice = resolve;
  });
  const startup = createStagedRuntimeStartup({
    waitForVoice: () => {
      voiceWaits += 1;
      return voiceReady;
    },
    launchDeferred: () => {
      deferredLaunches += 1;
    },
  });

  const first = startup.start();
  const duplicate = startup.start();
  await Promise.resolve();

  assert.strictEqual(first, duplicate);
  assert.equal(voiceWaits, 1);
  assert.equal(deferredLaunches, 0);
  assert.deepEqual(startup.status(), {
    phase: "waiting-for-voice",
    launched: false,
  });

  resolveVoice({ ok: true });
  const result = await first;

  assert.deepEqual(result, { launched: true, cancelled: false });
  assert.equal(deferredLaunches, 1);
  assert.deepEqual(startup.status(), { phase: "ready", launched: true });
  await startup.start();
  assert.equal(deferredLaunches, 1);
});

test("staged startup does not launch deferred services after shutdown", async () => {
  let cancelled = false;
  let resolveVoice;
  let deferredLaunches = 0;
  const voiceReady = new Promise((resolve) => {
    resolveVoice = resolve;
  });
  const startup = createStagedRuntimeStartup({
    waitForVoice: () => voiceReady,
    launchDeferred: () => {
      deferredLaunches += 1;
    },
    isCancelled: () => cancelled,
  });

  const resultPromise = startup.start();
  await Promise.resolve();
  cancelled = true;
  resolveVoice({ ok: true });

  assert.deepEqual(await resultPromise, {
    launched: false,
    cancelled: true,
  });
  assert.equal(deferredLaunches, 0);
  assert.deepEqual(startup.status(), {
    phase: "cancelled",
    launched: false,
  });
});

test("staged startup fails open when voice exceeds its deadline", async () => {
  let fireDeadline;
  let resolveVoice;
  let deferredLaunches = 0;
  let launchState;
  const warnings = [];
  const voiceReady = new Promise((resolve) => {
    resolveVoice = resolve;
  });
  const startup = createStagedRuntimeStartup({
    waitForVoice: () => voiceReady,
    launchDeferred: (voiceState) => {
      deferredLaunches += 1;
      launchState = voiceState;
    },
    voiceDeadlineMs: 15_000,
    setTimeoutImpl: (callback, milliseconds) => {
      assert.equal(milliseconds, 15_000);
      fireDeadline = callback;
      return 1;
    },
    onError: (error) => warnings.push(error.message),
  });

  const resultPromise = startup.start();
  await Promise.resolve();
  assert.equal(deferredLaunches, 0);

  fireDeadline();
  assert.deepEqual(await resultPromise, { launched: true, cancelled: false });
  assert.equal(deferredLaunches, 1);
  assert.equal(launchState.voiceReady, false);
  assert.equal(launchState.reason, "deadline");
  assert.match(launchState.error.message, /15000ms/u);
  assert.deepEqual(warnings, ["Voice startup deadline exceeded after 15000ms"]);
  assert.deepEqual(startup.status(), { phase: "ready", launched: true });

  resolveVoice({ ok: true });
  await Promise.resolve();
  await startup.start();
  assert.equal(deferredLaunches, 1);
});

test("staged startup fails open immediately when voice startup rejects", async () => {
  const voiceError = new Error("voice process exited");
  let launchState;
  let clearedTimer = false;
  const startup = createStagedRuntimeStartup({
    waitForVoice: async () => {
      throw voiceError;
    },
    launchDeferred: (voiceState) => {
      launchState = voiceState;
    },
    setTimeoutImpl: () => 42,
    clearTimeoutImpl: (timer) => {
      assert.equal(timer, 42);
      clearedTimer = true;
    },
  });

  assert.deepEqual(await startup.start(), { launched: true, cancelled: false });
  assert.equal(clearedTimer, true);
  assert.equal(launchState.voiceReady, false);
  assert.equal(launchState.reason, "voice-error");
  assert.strictEqual(launchState.error, voiceError);
});

test("voice deadline cannot launch deferred services after shutdown", async () => {
  let cancelled = false;
  let fireDeadline;
  let deferredLaunches = 0;
  const startup = createStagedRuntimeStartup({
    waitForVoice: () => new Promise(() => {}),
    launchDeferred: () => {
      deferredLaunches += 1;
    },
    isCancelled: () => cancelled,
    setTimeoutImpl: (callback) => {
      fireDeadline = callback;
      return 1;
    },
  });

  const resultPromise = startup.start();
  await Promise.resolve();
  cancelled = true;
  fireDeadline();

  assert.deepEqual(await resultPromise, {
    launched: false,
    cancelled: true,
  });
  assert.equal(deferredLaunches, 0);
  assert.deepEqual(startup.status(), {
    phase: "cancelled",
    launched: false,
  });
});
