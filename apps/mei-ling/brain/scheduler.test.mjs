import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openBrainDb } from "./db.mjs";
import {
  createBrainScheduler,
  isQuietHours,
  localDateKey,
} from "./scheduler.mjs";

async function temporaryDatabase(t) {
  const directory = await mkdtemp(join(tmpdir(), "mei-scheduler-test-"));
  const db = openBrainDb({ filename: join(directory, "brain.sqlite") });
  t.after(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  return db;
}

function createFakeTimers() {
  const timeouts = [];
  const intervals = [];
  const createHandle = (kind, callback, delay) => ({
    kind,
    callback,
    delay,
    cleared: false,
    unrefCalled: false,
    unref() {
      this.unrefCalled = true;
    },
  });

  return {
    timeouts,
    intervals,
    setTimeoutFn(callback, delay) {
      const handle = createHandle("timeout", callback, delay);
      timeouts.push(handle);
      return handle;
    },
    clearTimeoutFn(handle) {
      handle.cleared = true;
    },
    setIntervalFn(callback, delay) {
      const handle = createHandle("interval", callback, delay);
      intervals.push(handle);
      return handle;
    },
    clearIntervalFn(handle) {
      handle.cleared = true;
    },
  };
}

test("uses the Europe/Rome calendar date", () => {
  assert.equal(
    localDateKey(new Date("2026-07-28T22:30:00.000Z"), "Europe/Rome"),
    "2026-07-29",
  );
});

test("enforces quiet hours across midnight", () => {
  assert.equal(
    isQuietHours(new Date("2026-07-29T04:00:00.000Z"), { timeZone: "Europe/Rome" }),
    true,
  );
  assert.equal(
    isQuietHours(new Date("2026-07-29T10:00:00.000Z"), { timeZone: "Europe/Rome" }),
    false,
  );
});

test("creates only one automatic evergreen Daily Intel per day when no news qualifies", async (t) => {
  const db = await temporaryDatabase(t);
  const now = new Date("2026-08-03T10:00:00.000Z");
  const emitted = [];
  const scheduler = createBrainScheduler({
    db,
    complete: async () => {
      throw new Error("the model is not needed for evergreen");
    },
    emit: (eventName, payload) => {
      emitted.push({ eventName, payload });
      return true;
    },
    clock: () => now,
    sourceProvider: () => [],
  });

  const first = await scheduler.runScan();
  assert.equal(first.duplicate, false);
  assert.equal(first.briefing.kind, "daily-intel");
  assert.equal(first.briefing.contentType, "evergreen");
  assert.equal(first.briefing.claimStatus, "evergreen");
  assert.equal(first.briefing.sourceTier, "evergreen");
  assert.equal(first.briefing.recommendation, "cover");
  assert.match(first.briefing.title, /^Evergreen:/u);
  assert.equal(emitted.length, 1);

  const repeated = await scheduler.runScan();
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.forced, false);
  assert.equal(repeated.briefing, null);
  assert.equal(db.listBriefings({ kind: "daily-intel" }).length, 1);
  assert.equal(emitted.length, 1);
});

test("an explicit force refresh replaces the briefing on the same day", async (t) => {
  const db = await temporaryDatabase(t);
  const now = new Date("2026-08-03T10:00:00.000Z");
  const scheduler = createBrainScheduler({
    db,
    complete: async () => {
      throw new Error("the model is not needed for evergreen");
    },
    clock: () => now,
    sourceProvider: () => [],
  });

  const first = await scheduler.runScan();
  const refreshed = await scheduler.runScan({ force: true });

  assert.equal(first.duplicate, false);
  assert.equal(refreshed.forced, true);
  assert.equal(refreshed.duplicate, false);
  assert.equal(refreshed.briefing.kind, "daily-intel");
  assert.equal(refreshed.briefing.contentType, "evergreen");
  assert.notEqual(refreshed.briefing.id, first.briefing.id);
  assert.equal(db.listBriefings({ kind: "daily-intel" }).length, 1);
  assert.equal(db.getBriefing(first.briefing.id), null);
});

test("waits for the full initial delay before the first scheduler tick", async (t) => {
  const db = await temporaryDatabase(t);
  const timers = createFakeTimers();
  let acquireCalls = 0;
  const acquireDueJobs = db.acquireDueJobs.bind(db);
  db.acquireDueJobs = (...args) => {
    acquireCalls += 1;
    return acquireDueJobs(...args);
  };
  const scheduler = createBrainScheduler({
    db,
    complete: async () => "{}",
    clock: () => new Date("2026-08-05T10:00:00.000Z"),
    sourceProvider: () => [],
    initialDelayMs: 90_000,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  });
  t.after(() => scheduler.stop());

  scheduler.start();
  scheduler.start();

  assert.equal(acquireCalls, 0);
  assert.equal(timers.timeouts.length, 1);
  assert.equal(timers.timeouts[0].delay, 90_000);
  assert.equal(timers.timeouts[0].unrefCalled, true);
  assert.equal(timers.intervals.length, 0);
  assert.equal(scheduler.status().scheduler, "running");
  assert.equal(scheduler.status().schedulerPhase, "waiting");
  assert.equal(scheduler.status().backgroundStartDelayMs, 90_000);

  timers.timeouts[0].callback();

  assert.equal(acquireCalls, 1);
  assert.equal(timers.intervals.length, 1);
  assert.equal(timers.intervals[0].delay, 30_000);
  assert.equal(timers.intervals[0].unrefCalled, true);
  assert.equal(scheduler.status().schedulerPhase, "polling");
});

test("stop cancels both startup waiting and active polling", async (t) => {
  const db = await temporaryDatabase(t);
  const timers = createFakeTimers();
  const scheduler = createBrainScheduler({
    db,
    complete: async () => "{}",
    clock: () => new Date("2026-08-05T10:00:00.000Z"),
    sourceProvider: () => [],
    initialDelayMs: 90_000,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  });
  t.after(() => scheduler.stop());

  scheduler.start();
  const startupHandle = timers.timeouts[0];
  scheduler.stop();

  assert.equal(startupHandle.cleared, true);
  assert.equal(scheduler.status().scheduler, "stopped");
  assert.equal(scheduler.status().schedulerPhase, "stopped");

  scheduler.start();
  const restartedHandle = timers.timeouts[1];
  restartedHandle.callback();
  const pollingHandle = timers.intervals[0];

  assert.equal(scheduler.status().scheduler, "running");
  assert.equal(scheduler.status().schedulerPhase, "polling");

  scheduler.stop();

  assert.equal(pollingHandle.cleared, true);
  assert.equal(scheduler.status().scheduler, "stopped");
  assert.equal(scheduler.status().schedulerPhase, "stopped");
});
