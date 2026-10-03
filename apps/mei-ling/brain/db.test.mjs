import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SCHEMA_VERSION,
  openBrainDb,
  safeJsonParse,
  safeJsonStringify,
} from "./db.mjs";
import {
  POLICY_MODE,
  classifyAction,
  hashActionPayload,
  stableJson,
} from "./policy.mjs";

async function temporaryDatabase(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "mei-brain-test-"));
  const filename = join(directory, "brain.sqlite");
  const db = openBrainDb({ filename, ...options });
  t.after(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { filename, db };
}

test("migrates all brain tables and enables WAL", async (t) => {
  const { db } = await temporaryDatabase(t);

  assert.equal(db.schemaVersion, SCHEMA_VERSION);
  assert.equal(db.getJournalMode(), "wal");
  db.setSetting("schema_smoke", [
    "settings",
    "instructions",
    "messages",
    "sources",
    "intel_items",
    "briefings",
    "jobs",
    "actions",
    "audit_log",
  ]);
  assert.equal(db.getSetting("schema_smoke").length, 9);
});

test("persists settings, instructions, history and briefings across reopen", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mei-brain-persist-"));
  const filename = join(directory, "brain.sqlite");

  const first = openBrainDb({
    filename,
    seed: {
      settings: { locale: "it-IT" },
      instructions: [
        {
          id: "always-call-miura",
          scope: "identity",
          text: "Call the user Miura.",
          priority: 100,
        },
      ],
    },
  });
  first.addMessage({
    id: "m1",
    role: "user",
    content: "Ricordati questa idea.",
    createdAt: "2026-07-29T08:00:00.000Z",
  });
  first.addMessage({
    id: "m2",
    role: "assistant",
    content: "Segnata, Miura.",
    createdAt: "2026-07-29T08:00:01.000Z",
  });
  first.createBriefing({
    id: "briefing-1",
    title: "Daily Intel",
    body: "Tre opportunità da valutare.",
    itemIds: ["intel-1"],
  });
  first.close();

  const second = openBrainDb({
    filename,
    seed: {
      settings: { locale: "en-US" },
      instructions: [{ id: "replacement", text: "Do not replace existing data." }],
    },
  });
  t.after(async () => {
    second.close();
    await rm(directory, { recursive: true, force: true });
  });

  assert.equal(second.getSetting("locale"), "it-IT");
  assert.deepEqual(
    second.listInstructions().map((instruction) => instruction.id),
    ["always-call-miura"],
  );
  assert.deepEqual(
    second
      .getConversationHistory()
      .map(({ role, content }) => [role, content]),
    [
      ["user", "Ricordati questa idea."],
      ["assistant", "Segnata, Miura."],
    ],
  );
  assert.equal(second.listUnreadBriefings().length, 1);
  second.markBriefingRead("briefing-1");
  assert.equal(second.listUnreadBriefings().length, 0);
});

test("lists briefing history by kind while excluding dismissed entries by default", async (t) => {
  const { db } = await temporaryDatabase(t);
  db.createBriefing({
    id: "daily-old",
    kind: "daily",
    title: "Daily Intel",
    body: "Old daily briefing.",
    createdAt: "2026-07-29T08:00:00.000Z",
  });
  db.createBriefing({
    id: "debrief-kept",
    kind: "call-debrief",
    title: "Call debrief",
    body: "Keep this debrief.",
    createdAt: "2026-07-29T09:00:00.000Z",
  });
  db.createBriefing({
    id: "debrief-dismissed",
    kind: "call-debrief",
    title: "Dismissed debrief",
    body: "Hide this by default.",
    createdAt: "2026-07-29T10:00:00.000Z",
  });
  db.dismissBriefing("debrief-dismissed");

  assert.deepEqual(
    db.listBriefings({ kind: "call-debrief" }).map((entry) => entry.id),
    ["debrief-kept"],
  );
  assert.deepEqual(
    db
      .listBriefings({
        kind: "call-debrief",
        includeDismissed: true,
        limit: 2,
      })
      .map((entry) => entry.id),
    ["debrief-dismissed", "debrief-kept"],
  );
  assert.deepEqual(
    db.listBriefings({ limit: 1 }).map((entry) => entry.id),
    ["debrief-kept"],
  );
});

test("deletes only the replaceable briefing kind", async (t) => {
  const { db } = await temporaryDatabase(t);
  db.createBriefing({ id: "intel-old", kind: "daily-intel", title: "Intel", body: "Old" });
  db.createBriefing({ id: "debrief-kept", kind: "call-debrief", title: "Debrief", body: "Keep" });
  assert.equal(db.deleteBriefingsByKind("daily-intel"), 1);
  assert.deepEqual(db.listBriefings({ kind: "daily-intel", includeDismissed: true }), []);
  assert.equal(db.getBriefing("debrief-kept")?.id, "debrief-kept");
});
test("upserts sources and ranks trusted relevant intel first", async (t) => {
  const now = Date.parse("2026-07-29T12:00:00.000Z");
  const { db } = await temporaryDatabase(t, {
    clock: () => new Date(now),
  });

  const trusted = db.upsertSource({
    url: "https://publisher.example/news",
    title: "Publisher",
    trust: 0.95,
  });
  const lowTrust = db.upsertSource({
    url: "https://rumor.example/feed",
    title: "Rumor feed",
    trust: 0.1,
  });
  db.upsertIntelItem({
    id: "high",
    sourceId: trusted.id,
    title: "Major RPG announced",
    publishedAt: "2026-07-29T11:30:00.000Z",
    relevance: 1,
    novelty: 0.9,
    confidence: 1,
    urgency: 0.8,
  });
  db.upsertIntelItem({
    id: "low",
    sourceId: lowTrust.id,
    title: "Old unverified rumor",
    publishedAt: "2026-06-01T11:30:00.000Z",
    relevance: 0.4,
    novelty: 0.2,
    confidence: 0.1,
    urgency: 0.1,
  });

  assert.deepEqual(
    db.listRankedIntel().map((item) => item.id),
    ["high", "low"],
  );
  db.markIntelRead("high");
  assert.deepEqual(
    db.listRankedIntel({ unreadOnly: true }).map((item) => item.id),
    ["low"],
  );
  const updated = db.upsertIntelItem({
    id: "high",
    sourceId: trusted.id,
    title: "Major RPG announced - official details",
    publishedAt: "2026-07-29T11:30:00.000Z",
    relevance: 1,
    novelty: 1,
    confidence: 1,
    urgency: 1,
  });
  assert.equal(updated.title, "Major RPG announced - official details");
  assert.ok(updated.read_at, "upsert preserves read state");
});

test("leases jobs to one worker and permits takeover only after expiry", async (t) => {
  let nowMs = Date.parse("2026-07-29T12:00:00.000Z");
  const { db } = await temporaryDatabase(t, {
    clock: () => new Date(nowMs),
  });

  db.upsertJob({
    id: "daily-intel",
    type: "local.research",
    nextRunAt: new Date(nowMs),
  });
  const firstLease = db.acquireDueJobs("worker-a", { leaseMs: 10_000 });
  assert.equal(firstLease.length, 1);
  assert.equal(firstLease[0].lock_owner, "worker-a");
  assert.equal(db.acquireDueJobs("worker-b").length, 0);

  nowMs += 11_000;
  const takeover = db.acquireDueJobs("worker-b", { leaseMs: 10_000 });
  assert.equal(takeover.length, 1);
  assert.equal(takeover[0].lock_owner, "worker-b");
  assert.equal(db.renewJobLock("daily-intel", "worker-a"), null);

  const completed = db.completeJob("daily-intel", "worker-b", {
    result: { found: 4 },
  });
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.lastResult, { found: 4 });
  assert.equal(db.acquireDueJobs("worker-c").length, 0);
});

test("policy allows local prep and gates every external mutation category", () => {
  for (const type of [
    "local.research",
    "draft.video_script",
    "analyze.channel",
    "rank.intel",
    "transcribe.local_audio",
  ]) {
    assert.equal(classifyAction(type).mode, POLICY_MODE.AUTONOMOUS, type);
  }

  const external = new Map([
    ["social.publish", "publish"],
    ["external.send_message", "message"],
    ["purchase.game", "spend"],
    ["upload.video", "upload"],
    ["account.update", "account"],
    ["security.rotate_api_key", "security"],
    ["delete.local_file", "delete"],
  ]);
  for (const [type, category] of external) {
    const decision = classifyAction(type);
    assert.equal(decision.mode, POLICY_MODE.APPROVAL_REQUIRED, type);
    assert.equal(decision.category, category, type);
  }
  assert.equal(
    classifyAction("new_unrecognized_power").mode,
    POLICY_MODE.APPROVAL_REQUIRED,
  );
  assert.equal(
    hashActionPayload("social.publish", { b: 2, a: 1 }),
    hashActionPayload("social.publish", { a: 1, b: 2 }),
  );
});

test("approval is payload-bound, expiring and consumed exactly once", async (t) => {
  let nowMs = Date.parse("2026-07-29T12:00:00.000Z");
  let tokenCounter = 0;
  const { db } = await temporaryDatabase(t, {
    clock: () => new Date(nowMs),
    tokenFactory: () => `approval-token-${++tokenCounter}`,
  });

  const payload = {
    platform: "youtube",
    title: "Codec test",
    videoPath: "C:/exports/codec.mp4",
  };
  const requested = db.requestAction({
    id: "publish-1",
    type: "social.publish",
    payload,
  });
  assert.equal(requested.status, "pending");
  assert.equal(db.listPendingActions().length, 1);

  const approved = db.approveAction("publish-1", { expiresInMs: 60_000 });
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvalToken, "approval-token-1");
  assert.equal(db.listPendingActions().length, 0);

  assert.throws(
    () =>
      db.consumeAction("publish-1", {
        type: "social.publish",
        payload: { ...payload, title: "Changed after approval" },
        approvalToken: approved.approvalToken,
      }),
    /does not match/,
  );
  assert.equal(db.getAction("publish-1").status, "approved");

  const consumed = db.consumeAction("publish-1", {
    type: "social.publish",
    payload,
    approvalToken: approved.approvalToken,
  });
  assert.equal(consumed.status, "consumed");
  assert.throws(
    () =>
      db.consumeAction("publish-1", {
        type: "social.publish",
        payload,
        approvalToken: approved.approvalToken,
      }),
    /already been consumed/,
  );

  const local = db.requestAction({
    id: "draft-1",
    type: "local.draft",
    payload: { topic: "indie games" },
  });
  assert.equal(local.status, "ready");
  assert.equal(
    db.consumeAction("draft-1", {
      type: "local.draft",
      payload: { topic: "indie games" },
    }).status,
    "consumed",
  );

  const expiring = db.requestAction({
    id: "message-1",
    type: "external.send_message",
    payload: { to: "editor@example.test", body: "Hello" },
  });
  const shortApproval = db.approveAction(expiring.id, { expiresInMs: 1_000 });
  nowMs += 1_001;
  assert.throws(
    () =>
      db.consumeAction(expiring.id, {
        type: expiring.type,
        payload: expiring.payload,
        approvalToken: shortApproval.approvalToken,
      }),
    /expired/,
  );
  assert.equal(db.getAction(expiring.id).status, "expired");

  assert.deepEqual(
    db
      .listAuditLog({ entityType: "action", entityId: "publish-1" })
      .map((entry) => entry.event)
      .sort(),
    ["action.approved", "action.consumed", "action.requested"].sort(),
  );
});

test("safe JSON helpers tolerate malformed and hostile values", () => {
  assert.deepEqual(safeJsonParse('{"ok":1,"__proto__":{"polluted":true}}'), {
    ok: 1,
  });
  assert.equal(safeJsonParse("{broken", "fallback"), "fallback");
  assert.equal(safeJsonStringify({ count: 4n }), '{"count":"4"}');
  const circular = {};
  circular.self = circular;
  assert.equal(safeJsonStringify(circular, "fallback"), "fallback");
  assert.equal(stableJson({ z: 1, a: 2 }), '{"a":2,"z":1}');
});
