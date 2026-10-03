import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  POLICY_MODE,
  classifyAction,
  hashActionPayload,
} from "./policy.mjs";

export const SCHEMA_VERSION = 1;

const BLOCKED_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const DEFAULT_APPROVAL_REQUEST_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_APPROVAL_USE_TTL_MS = 15 * 60 * 1_000;

const MIGRATIONS = [
  `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS instructions (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'general',
      text TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_instructions_active
      ON instructions(enabled, priority DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL DEFAULT 'main',
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'web',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      trust REAL NOT NULL DEFAULT 0.5 CHECK (trust >= 0 AND trust <= 1),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      last_checked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_sources_enabled
      ON sources(enabled, trust DESC);

    CREATE TABLE IF NOT EXISTS intel_items (
      id TEXT PRIMARY KEY,
      source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
      external_id TEXT,
      url TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      discovered_at TEXT NOT NULL,
      relevance REAL NOT NULL DEFAULT 0.5 CHECK (relevance >= 0 AND relevance <= 1),
      novelty REAL NOT NULL DEFAULT 0.5 CHECK (novelty >= 0 AND novelty <= 1),
      confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
      urgency REAL NOT NULL DEFAULT 0.5 CHECK (urgency >= 0 AND urgency <= 1),
      rank_score REAL NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      read_at TEXT,
      used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intel_source_external
      ON intel_items(source_id, external_id)
      WHERE external_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_intel_rank
      ON intel_items(read_at, rank_score DESC, published_at DESC);

    CREATE TABLE IF NOT EXISTS briefings (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'daily',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      item_ids_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      read_at TEXT,
      dismissed_at TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_briefings_unread
      ON briefings(read_at, dismissed_at, created_at DESC);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      schedule TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'retry', 'completed', 'failed', 'paused')),
      next_run_at TEXT,
      last_run_at TEXT,
      lock_owner TEXT,
      lock_until TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_jobs_due
      ON jobs(enabled, status, next_run_at, priority DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_lock
      ON jobs(lock_until, lock_owner);

    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('autonomous', 'approval_required')),
      description TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL
        CHECK (status IN ('ready', 'pending', 'approved', 'consumed', 'rejected', 'expired')),
      approval_token_hash TEXT,
      requested_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      approved_at TEXT,
      consumed_at TEXT,
      rejected_at TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_actions_pending
      ON actions(status, expires_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_audit_entity
      ON audit_log(entity_type, entity_id, created_at DESC);
  `,
];

function asIso(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new TypeError("Expected a valid date, timestamp, or ISO date string.");
}

function clamp01(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

function stableId(prefix, value) {
  const digest = createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

function assertNonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

/** Parse trusted-or-untrusted JSON without throwing or accepting prototype keys. */
export function safeJsonParse(text, fallback = null) {
  if (typeof text !== "string") return fallback;
  try {
    return JSON.parse(text, (key, value) =>
      BLOCKED_JSON_KEYS.has(key) ? undefined : value,
    );
  } catch {
    return fallback;
  }
}

/** Stringify JSON-like values while filtering prototype keys and supporting bigint. */
export function safeJsonStringify(value, fallback = "{}") {
  try {
    const encoded = JSON.stringify(value, (key, entry) => {
      if (BLOCKED_JSON_KEYS.has(key)) return undefined;
      if (typeof entry === "bigint") return entry.toString();
      if (typeof entry === "number" && !Number.isFinite(entry)) return null;
      return entry;
    });
    return encoded === undefined ? fallback : encoded;
  } catch {
    return fallback;
  }
}

/**
 * Score an intel item from 0..100. Freshness decays over seven days and source
 * trust is included so rankings can be recalculated when a source changes.
 */
export function scoreIntel(item, { sourceTrust = 0.5, now = Date.now() } = {}) {
  const timestamp = Date.parse(item.publishedAt ?? item.discoveredAt ?? now);
  const ageDays = Number.isFinite(timestamp)
    ? Math.max(0, (new Date(now).getTime() - timestamp) / 86_400_000)
    : 30;
  const freshness = Math.exp(-ageDays / 7);
  const score =
    clamp01(item.relevance) * 0.35 +
    clamp01(item.novelty) * 0.2 +
    clamp01(item.confidence) * 0.15 +
    clamp01(item.urgency) * 0.1 +
    clamp01(sourceTrust) * 0.1 +
    freshness * 0.1;
  return Math.round(score * 10_000) / 100;
}

function decodeJsonFields(row, mapping) {
  if (!row) return null;
  const output = { ...row };
  for (const [column, property, fallback] of mapping) {
    output[property] = safeJsonParse(output[column], fallback);
    delete output[column];
  }
  return output;
}

function decodeInstruction(row) {
  const value = decodeJsonFields(row, [["metadata_json", "metadata", {}]]);
  if (!value) return null;
  value.enabled = Boolean(value.enabled);
  return value;
}

function decodeMessage(row) {
  return decodeJsonFields(row, [["metadata_json", "metadata", {}]]);
}

function decodeSource(row) {
  const value = decodeJsonFields(row, [["metadata_json", "metadata", {}]]);
  if (!value) return null;
  value.enabled = Boolean(value.enabled);
  return value;
}

function decodeIntel(row) {
  return decodeJsonFields(row, [
    ["tags_json", "tags", []],
    ["metadata_json", "metadata", {}],
  ]);
}

function decodeBriefing(row) {
  return decodeJsonFields(row, [
    ["item_ids_json", "itemIds", []],
    ["metadata_json", "metadata", {}],
  ]);
}

function decodeJob(row) {
  const value = decodeJsonFields(row, [
    ["payload_json", "payload", {}],
    ["last_result_json", "lastResult", null],
  ]);
  if (!value) return null;
  value.enabled = Boolean(value.enabled);
  return value;
}

function decodeAction(row) {
  const value = decodeJsonFields(row, [["payload_json", "payload", {}]]);
  if (!value) return null;
  delete value.approval_token_hash;
  return value;
}

function decodeAudit(row) {
  return decodeJsonFields(row, [["details_json", "details", {}]]);
}

/**
 * Persistent local brain store.
 *
 * Exported methods cover:
 * - settings and standing instructions
 * - conversation history
 * - sources, ranked intel and unread briefings
 * - leased job execution
 * - payload-bound, expiring, one-use approval actions
 * - append-only audit history
 */
export class BrainDb {
  #db;
  #clock;
  #idFactory;
  #tokenFactory;

  constructor(
    filename,
    {
      seed,
      clock = () => new Date(),
      idFactory = () => randomUUID(),
      tokenFactory = () => randomBytes(32).toString("base64url"),
    } = {},
  ) {
    const databasePath = filename === ":memory:" ? filename : resolve(filename);
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.#clock = clock;
    this.#idFactory = idFactory;
    this.#tokenFactory = tokenFactory;
    this.#db = new DatabaseSync(databasePath);
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA synchronous = NORMAL");
    this.#migrate();

    if (seed) {
      this.seed(seed, { onlyIfEmpty: true });
    }
  }

  close() {
    this.#db.close();
  }

  get schemaVersion() {
    return Number(this.#db.prepare("PRAGMA user_version").get().user_version);
  }

  getJournalMode() {
    return this.#db.prepare("PRAGMA journal_mode").get().journal_mode;
  }

  #now() {
    return asIso(this.#clock());
  }

  #migrate() {
    const current = Number(
      this.#db.prepare("PRAGMA user_version").get().user_version,
    );
    if (current > SCHEMA_VERSION) {
      throw new Error(
        `Brain database schema ${current} is newer than supported ${SCHEMA_VERSION}.`,
      );
    }

    for (let version = current + 1; version <= SCHEMA_VERSION; version += 1) {
      this.#db.exec("BEGIN IMMEDIATE");
      try {
        this.#db.exec(MIGRATIONS[version - 1]);
        this.#db.exec(`PRAGMA user_version = ${version}`);
        this.#db.exec("COMMIT");
      } catch (error) {
        this.#db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  #audit(event, entityType, entityId, details = {}, createdAt = this.#now()) {
    this.#db
      .prepare(
        `INSERT INTO audit_log
          (event, entity_type, entity_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        event,
        entityType,
        entityId ?? null,
        safeJsonStringify(details),
        createdAt,
      );
  }

  #transaction(operation) {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  // Settings ---------------------------------------------------------------

  setSetting(key, value) {
    const settingKey = assertNonEmpty(key, "Setting key");
    const now = this.#now();
    this.#db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
      )
      .run(settingKey, safeJsonStringify(value, "null"), now);
    return this.getSetting(settingKey);
  }

  getSetting(key, fallback = null) {
    const row = this.#db
      .prepare("SELECT value_json FROM settings WHERE key = ?")
      .get(key);
    return row ? safeJsonParse(row.value_json, fallback) : fallback;
  }

  listSettings() {
    const rows = this.#db.prepare("SELECT key, value_json FROM settings").all();
    return Object.fromEntries(
      rows.map((row) => [row.key, safeJsonParse(row.value_json)]),
    );
  }

  // Standing instructions --------------------------------------------------

  upsertInstruction({
    id,
    scope = "general",
    text,
    priority = 0,
    enabled = true,
    metadata = {},
  }) {
    const cleanScope = assertNonEmpty(scope, "Instruction scope");
    const cleanText = assertNonEmpty(text, "Instruction text");
    const instructionId =
      id ?? stableId("instruction", `${cleanScope}\0${cleanText}`);
    const now = this.#now();
    this.#db
      .prepare(
        `INSERT INTO instructions
          (id, scope, text, priority, enabled, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           scope = excluded.scope,
           text = excluded.text,
           priority = excluded.priority,
           enabled = excluded.enabled,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        instructionId,
        cleanScope,
        cleanText,
        Math.trunc(Number(priority) || 0),
        enabled ? 1 : 0,
        safeJsonStringify(metadata),
        now,
        now,
      );
    this.#audit("instruction.upserted", "instruction", instructionId, {
      scope: cleanScope,
      enabled: Boolean(enabled),
    });
    return this.getInstruction(instructionId);
  }

  getInstruction(id) {
    return decodeInstruction(
      this.#db.prepare("SELECT * FROM instructions WHERE id = ?").get(id),
    );
  }

  listInstructions({ scope, enabledOnly = true } = {}) {
    const conditions = [];
    const values = [];
    if (scope) {
      conditions.push("scope = ?");
      values.push(scope);
    }
    if (enabledOnly) {
      conditions.push("enabled = 1");
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.#db
      .prepare(
        `SELECT * FROM instructions ${where}
         ORDER BY priority DESC, updated_at DESC, id ASC`,
      )
      .all(...values)
      .map(decodeInstruction);
  }

  setInstructionEnabled(id, enabled) {
    const now = this.#now();
    const result = this.#db
      .prepare(
        "UPDATE instructions SET enabled = ?, updated_at = ? WHERE id = ?",
      )
      .run(enabled ? 1 : 0, now, id);
    if (!result.changes) return null;
    this.#audit("instruction.toggled", "instruction", id, {
      enabled: Boolean(enabled),
    });
    return this.getInstruction(id);
  }

  // Conversation history ---------------------------------------------------

  addMessage({
    id = this.#idFactory(),
    conversationId = "main",
    role,
    content,
    metadata = {},
    createdAt = this.#now(),
  }) {
    const validRoles = new Set(["system", "user", "assistant", "tool"]);
    if (!validRoles.has(role)) {
      throw new TypeError(`Unsupported message role: ${role}`);
    }
    const cleanContent = assertNonEmpty(content, "Message content");
    this.#db
      .prepare(
        `INSERT INTO messages
          (id, conversation_id, role, content, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        assertNonEmpty(conversationId, "Conversation id"),
        role,
        cleanContent,
        safeJsonStringify(metadata),
        asIso(createdAt),
      );
    return decodeMessage(
      this.#db.prepare("SELECT * FROM messages WHERE id = ?").get(id),
    );
  }

  getConversationHistory({
    conversationId = "main",
    limit = 50,
    before,
  } = {}) {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = before
      ? this.#db
          .prepare(
            `SELECT * FROM messages
             WHERE conversation_id = ? AND created_at < ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?`,
          )
          .all(conversationId, asIso(before), boundedLimit)
      : this.#db
          .prepare(
            `SELECT * FROM messages
             WHERE conversation_id = ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?`,
          )
          .all(conversationId, boundedLimit);
    return rows.reverse().map(decodeMessage);
  }

  clearConversation(conversationId = "main") {
    const result = this.#db
      .prepare("DELETE FROM messages WHERE conversation_id = ?")
      .run(conversationId);
    this.#audit("conversation.cleared", "conversation", conversationId, {
      deleted: Number(result.changes),
    });
    return Number(result.changes);
  }

  // Sources and intel -------------------------------------------------------

  upsertSource({
    id,
    url,
    title = "",
    kind = "web",
    enabled = true,
    trust = 0.5,
    metadata = {},
    lastCheckedAt = null,
  }) {
    const cleanUrl = assertNonEmpty(url, "Source URL");
    const sourceId = id ?? stableId("source", cleanUrl);
    const now = this.#now();
    this.#db
      .prepare(
        `INSERT INTO sources
          (id, url, title, kind, enabled, trust, metadata_json,
           last_checked_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           url = excluded.url,
           title = excluded.title,
           kind = excluded.kind,
           enabled = excluded.enabled,
           trust = excluded.trust,
           metadata_json = excluded.metadata_json,
           last_checked_at = COALESCE(excluded.last_checked_at, sources.last_checked_at),
           updated_at = excluded.updated_at`,
      )
      .run(
        sourceId,
        cleanUrl,
        String(title),
        String(kind),
        enabled ? 1 : 0,
        clamp01(trust),
        safeJsonStringify(metadata),
        lastCheckedAt ? asIso(lastCheckedAt) : null,
        now,
        now,
      );
    return this.getSource(sourceId);
  }

  getSource(id) {
    return decodeSource(
      this.#db.prepare("SELECT * FROM sources WHERE id = ?").get(id),
    );
  }

  listSources({ enabledOnly = false } = {}) {
    return this.#db
      .prepare(
        `SELECT * FROM sources
         ${enabledOnly ? "WHERE enabled = 1" : ""}
         ORDER BY trust DESC, title ASC`,
      )
      .all()
      .map(decodeSource);
  }

  upsertIntelItem({
    id,
    sourceId = null,
    externalId = null,
    url = null,
    title,
    summary = "",
    publishedAt = null,
    discoveredAt = this.#now(),
    relevance = 0.5,
    novelty = 0.5,
    confidence = 0.5,
    urgency = 0.5,
    tags = [],
    metadata = {},
  }) {
    const cleanTitle = assertNonEmpty(title, "Intel title");
    const discovered = asIso(discoveredAt);
    const source = sourceId ? this.getSource(sourceId) : null;
    const intelId =
      id ??
      stableId(
        "intel",
        `${sourceId ?? ""}\0${externalId ?? url ?? cleanTitle}`,
      );
    const rankScore = scoreIntel(
      {
        relevance,
        novelty,
        confidence,
        urgency,
        publishedAt,
        discoveredAt: discovered,
      },
      { sourceTrust: source?.trust ?? 0.5, now: this.#clock() },
    );
    const now = this.#now();

    this.#db
      .prepare(
        `INSERT INTO intel_items
          (id, source_id, external_id, url, title, summary, published_at,
           discovered_at, relevance, novelty, confidence, urgency, rank_score,
           tags_json, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           source_id = excluded.source_id,
           external_id = excluded.external_id,
           url = excluded.url,
           title = excluded.title,
           summary = excluded.summary,
           published_at = excluded.published_at,
           relevance = excluded.relevance,
           novelty = excluded.novelty,
           confidence = excluded.confidence,
           urgency = excluded.urgency,
           rank_score = excluded.rank_score,
           tags_json = excluded.tags_json,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        intelId,
        sourceId,
        externalId,
        url,
        cleanTitle,
        String(summary),
        publishedAt ? asIso(publishedAt) : null,
        discovered,
        clamp01(relevance),
        clamp01(novelty),
        clamp01(confidence),
        clamp01(urgency),
        rankScore,
        safeJsonStringify(tags, "[]"),
        safeJsonStringify(metadata),
        now,
        now,
      );
    return this.getIntelItem(intelId);
  }

  getIntelItem(id) {
    return decodeIntel(
      this.#db.prepare("SELECT * FROM intel_items WHERE id = ?").get(id),
    );
  }

  listRankedIntel({ limit = 25, unreadOnly = false, now = this.#clock() } = {}) {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = this.#db
      .prepare(
        `SELECT i.*, COALESCE(s.trust, 0.5) AS source_trust
         FROM intel_items i
         LEFT JOIN sources s ON s.id = i.source_id
         ${unreadOnly ? "WHERE i.read_at IS NULL" : ""}`,
      )
      .all()
      .map((row) => {
        const decoded = decodeIntel(row);
        decoded.rank_score = scoreIntel(
          {
            relevance: decoded.relevance,
            novelty: decoded.novelty,
            confidence: decoded.confidence,
            urgency: decoded.urgency,
            publishedAt: decoded.published_at,
            discoveredAt: decoded.discovered_at,
          },
          { sourceTrust: decoded.source_trust, now },
        );
        delete decoded.source_trust;
        return decoded;
      });

    return rows
      .sort(
        (left, right) =>
          right.rank_score - left.rank_score ||
          String(right.published_at ?? right.discovered_at).localeCompare(
            String(left.published_at ?? left.discovered_at),
          ),
      )
      .slice(0, boundedLimit);
  }

  markIntelRead(id, readAt = this.#now()) {
    const result = this.#db
      .prepare("UPDATE intel_items SET read_at = ?, updated_at = ? WHERE id = ?")
      .run(asIso(readAt), this.#now(), id);
    return result.changes ? this.getIntelItem(id) : null;
  }

  markIntelUsed(id, usedAt = this.#now()) {
    const result = this.#db
      .prepare("UPDATE intel_items SET used_at = ?, updated_at = ? WHERE id = ?")
      .run(asIso(usedAt), this.#now(), id);
    return result.changes ? this.getIntelItem(id) : null;
  }

  // Briefings ---------------------------------------------------------------

  createBriefing({
    id = this.#idFactory(),
    kind = "daily",
    title,
    body,
    itemIds = [],
    metadata = {},
    createdAt = this.#now(),
  }) {
    this.#db
      .prepare(
        `INSERT INTO briefings
          (id, kind, title, body, item_ids_json, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        assertNonEmpty(kind, "Briefing kind"),
        assertNonEmpty(title, "Briefing title"),
        assertNonEmpty(body, "Briefing body"),
        safeJsonStringify(itemIds, "[]"),
        safeJsonStringify(metadata),
        asIso(createdAt),
      );
    this.#audit("briefing.created", "briefing", id, { kind });
    return this.getBriefing(id);
  }

  getBriefing(id) {
    return decodeBriefing(
      this.#db.prepare("SELECT * FROM briefings WHERE id = ?").get(id),
    );
  }

  listBriefings({ kind, limit = 50, includeDismissed = false } = {}) {
    const numericLimit = Number(limit);
    const boundedLimit = Number.isFinite(numericLimit)
      ? Math.max(1, Math.min(200, Math.trunc(numericLimit)))
      : 50;
    const conditions = [];
    const values = [];
    if (kind !== undefined && kind !== null && String(kind).trim()) {
      conditions.push("kind = ?");
      values.push(assertNonEmpty(String(kind), "Briefing kind"));
    }
    if (!includeDismissed) {
      conditions.push("dismissed_at IS NULL");
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.#db
      .prepare(
        `SELECT * FROM briefings ${where}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(...values, boundedLimit)
      .map(decodeBriefing);
  }

  listUnreadBriefings({ limit = 20 } = {}) {
    return this.#db
      .prepare(
        `SELECT * FROM briefings
         WHERE read_at IS NULL AND dismissed_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(200, Math.trunc(limit))))
      .map(decodeBriefing);
  }

  markBriefingRead(id, readAt = this.#now()) {
    const result = this.#db
      .prepare("UPDATE briefings SET read_at = ? WHERE id = ?")
      .run(asIso(readAt), id);
    if (!result.changes) return null;
    this.#audit("briefing.read", "briefing", id);
    return this.getBriefing(id);
  }

  dismissBriefing(id, dismissedAt = this.#now()) {
    const result = this.#db
      .prepare("UPDATE briefings SET dismissed_at = ? WHERE id = ?")
      .run(asIso(dismissedAt), id);
    if (!result.changes) return null;
    this.#audit("briefing.dismissed", "briefing", id);
    return this.getBriefing(id);
  }

  deleteBriefingsByKind(kind) {
    const cleanKind = assertNonEmpty(String(kind), "Briefing kind");
    const ids = this.#db
      .prepare("SELECT id FROM briefings WHERE kind = ?")
      .all(cleanKind)
      .map((row) => row.id);
    const result = this.#db
      .prepare("DELETE FROM briefings WHERE kind = ?")
      .run(cleanKind);
    this.#audit("briefing.kind_deleted", "briefing", cleanKind, {
      deleted: result.changes,
      ids,
    });
    return result.changes;
  }

  // Jobs and leases ---------------------------------------------------------

  upsertJob({
    id,
    type,
    payload = {},
    schedule = null,
    priority = 0,
    enabled = true,
    status = "queued",
    nextRunAt = this.#now(),
  }) {
    const cleanType = assertNonEmpty(type, "Job type");
    const jobId = id ?? stableId("job", cleanType);
    const now = this.#now();
    this.#db
      .prepare(
        `INSERT INTO jobs
          (id, type, payload_json, schedule, priority, enabled, status,
           next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           payload_json = excluded.payload_json,
           schedule = excluded.schedule,
           priority = excluded.priority,
           enabled = excluded.enabled,
           status = CASE
             WHEN jobs.status = 'running' THEN jobs.status
             ELSE excluded.status
           END,
           next_run_at = excluded.next_run_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        jobId,
        cleanType,
        safeJsonStringify(payload),
        schedule,
        Math.trunc(Number(priority) || 0),
        enabled ? 1 : 0,
        status,
        nextRunAt ? asIso(nextRunAt) : null,
        now,
        now,
      );
    return this.getJob(jobId);
  }

  getJob(id) {
    return decodeJob(this.#db.prepare("SELECT * FROM jobs WHERE id = ?").get(id));
  }

  acquireDueJobs(
    workerId,
    { now = this.#now(), leaseMs = 60_000, limit = 1 } = {},
  ) {
    const owner = assertNonEmpty(workerId, "Worker id");
    const nowIso = asIso(now);
    const lockUntil = new Date(
      new Date(nowIso).getTime() + Math.max(1_000, Number(leaseMs)),
    ).toISOString();
    const boundedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));

    return this.#transaction(() => {
      const candidates = this.#db
        .prepare(
          `SELECT id FROM jobs
           WHERE enabled = 1
             AND status IN ('queued', 'retry', 'running')
             AND (next_run_at IS NULL OR next_run_at <= ?)
             AND (lock_until IS NULL OR lock_until <= ?)
           ORDER BY priority DESC, next_run_at ASC, id ASC
           LIMIT ?`,
        )
        .all(nowIso, nowIso, boundedLimit);

      const claimed = [];
      const claim = this.#db.prepare(
        `UPDATE jobs SET
           status = 'running',
           lock_owner = ?,
           lock_until = ?,
           attempts = attempts + 1,
           updated_at = ?
         WHERE id = ?
           AND enabled = 1
           AND (lock_until IS NULL OR lock_until <= ?)`,
      );
      const read = this.#db.prepare("SELECT * FROM jobs WHERE id = ?");

      for (const candidate of candidates) {
        const result = claim.run(
          owner,
          lockUntil,
          nowIso,
          candidate.id,
          nowIso,
        );
        if (result.changes) {
          claimed.push(decodeJob(read.get(candidate.id)));
          this.#audit(
            "job.locked",
            "job",
            candidate.id,
            { workerId: owner, lockUntil },
            nowIso,
          );
        }
      }
      return claimed;
    });
  }

  renewJobLock(id, workerId, { now = this.#now(), leaseMs = 60_000 } = {}) {
    const nowIso = asIso(now);
    const lockUntil = new Date(
      new Date(nowIso).getTime() + Math.max(1_000, Number(leaseMs)),
    ).toISOString();
    const result = this.#db
      .prepare(
        `UPDATE jobs SET lock_until = ?, updated_at = ?
         WHERE id = ? AND lock_owner = ? AND status = 'running'
           AND lock_until > ?`,
      )
      .run(lockUntil, nowIso, id, workerId, nowIso);
    return result.changes ? this.getJob(id) : null;
  }

  completeJob(
    id,
    workerId,
    { result = null, nextRunAt = null, now = this.#now() } = {},
  ) {
    const nowIso = asIso(now);
    const next = nextRunAt ? asIso(nextRunAt) : null;
    const update = this.#db
      .prepare(
        `UPDATE jobs SET
           status = ?,
           next_run_at = ?,
           last_run_at = ?,
           lock_owner = NULL,
           lock_until = NULL,
           last_error = NULL,
           last_result_json = ?,
           updated_at = ?
         WHERE id = ? AND lock_owner = ? AND status = 'running'`,
      )
      .run(
        next ? "queued" : "completed",
        next,
        nowIso,
        safeJsonStringify(result, "null"),
        nowIso,
        id,
        workerId,
      );
    if (!update.changes) return null;
    this.#audit("job.completed", "job", id, { workerId, nextRunAt: next }, nowIso);
    return this.getJob(id);
  }

  failJob(
    id,
    workerId,
    error,
    { retryAt = null, now = this.#now() } = {},
  ) {
    const nowIso = asIso(now);
    const next = retryAt ? asIso(retryAt) : null;
    const update = this.#db
      .prepare(
        `UPDATE jobs SET
           status = ?,
           next_run_at = ?,
           last_run_at = ?,
           lock_owner = NULL,
           lock_until = NULL,
           last_error = ?,
           updated_at = ?
         WHERE id = ? AND lock_owner = ? AND status = 'running'`,
      )
      .run(
        next ? "retry" : "failed",
        next,
        nowIso,
        String(error?.message ?? error ?? "Unknown job error"),
        nowIso,
        id,
        workerId,
      );
    if (!update.changes) return null;
    this.#audit("job.failed", "job", id, { workerId, retryAt: next }, nowIso);
    return this.getJob(id);
  }

  // Approval actions --------------------------------------------------------

  requestAction({
    id = this.#idFactory(),
    type,
    payload = {},
    description = "",
    expiresInMs = DEFAULT_APPROVAL_REQUEST_TTL_MS,
  }) {
    const policy = classifyAction(type);
    const now = this.#now();
    const expiresAt = new Date(
      new Date(now).getTime() + Math.max(1_000, Number(expiresInMs)),
    ).toISOString();
    const status =
      policy.mode === POLICY_MODE.AUTONOMOUS ? "ready" : "pending";
    const payloadHash = hashActionPayload(policy.type, payload);

    this.#db
      .prepare(
        `INSERT INTO actions
          (id, type, category, mode, description, payload_json, payload_hash,
           status, requested_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        policy.type,
        policy.category,
        policy.mode,
        String(description),
        safeJsonStringify(payload),
        payloadHash,
        status,
        now,
        expiresAt,
      );
    this.#audit("action.requested", "action", id, {
      type: policy.type,
      category: policy.category,
      mode: policy.mode,
      payloadHash,
    });
    return this.getAction(id);
  }

  getAction(id) {
    return decodeAction(
      this.#db.prepare("SELECT * FROM actions WHERE id = ?").get(id),
    );
  }

  listPendingActions({ limit = 50 } = {}) {
    return this.#db
      .prepare(
        `SELECT * FROM actions
         WHERE status = 'pending'
         ORDER BY requested_at ASC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(200, Math.trunc(limit))))
      .map(decodeAction);
  }

  approveAction(
    id,
    { expiresInMs = DEFAULT_APPROVAL_USE_TTL_MS, now = this.#now() } = {},
  ) {
    const nowIso = asIso(now);
    const token = this.#tokenFactory();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    let postCommitError = null;
    let action = null;

    this.#transaction(() => {
      const current = this.#db
        .prepare("SELECT * FROM actions WHERE id = ?")
        .get(id);
      if (!current) throw new Error(`Unknown action: ${id}`);
      if (current.mode !== POLICY_MODE.APPROVAL_REQUIRED) {
        throw new Error("Autonomous actions do not need approval.");
      }
      if (current.status !== "pending") {
        throw new Error(`Action cannot be approved from status ${current.status}.`);
      }
      if (Date.parse(current.expires_at) <= Date.parse(nowIso)) {
        this.#db
          .prepare("UPDATE actions SET status = 'expired' WHERE id = ?")
          .run(id);
        this.#audit("action.expired", "action", id, {}, nowIso);
        postCommitError = new Error("Action approval request has expired.");
        return;
      }

      const approvedExpiry = new Date(
        Date.parse(nowIso) + Math.max(1_000, Number(expiresInMs)),
      ).toISOString();
      this.#db
        .prepare(
          `UPDATE actions SET
             status = 'approved',
             approval_token_hash = ?,
             approved_at = ?,
             expires_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(tokenHash, nowIso, approvedExpiry, id);
      this.#audit(
        "action.approved",
        "action",
        id,
        { expiresAt: approvedExpiry },
        nowIso,
      );
      action = this.getAction(id);
    });

    if (postCommitError) throw postCommitError;
    return { ...action, approvalToken: token };
  }

  rejectAction(id, { now = this.#now(), reason = "" } = {}) {
    const nowIso = asIso(now);
    const result = this.#db
      .prepare(
        `UPDATE actions SET status = 'rejected', rejected_at = ?
         WHERE id = ? AND status IN ('pending', 'approved')`,
      )
      .run(nowIso, id);
    if (!result.changes) return null;
    this.#audit("action.rejected", "action", id, { reason }, nowIso);
    return this.getAction(id);
  }

  consumeAction(
    id,
    { type, payload, approvalToken = null, now = this.#now() },
  ) {
    const nowIso = asIso(now);
    let consumed = null;
    let postCommitError = null;

    this.#transaction(() => {
      const current = this.#db
        .prepare("SELECT * FROM actions WHERE id = ?")
        .get(id);
      if (!current) throw new Error(`Unknown action: ${id}`);
      if (current.status === "consumed") {
        throw new Error("Action approval has already been consumed.");
      }
      if (Date.parse(current.expires_at) <= Date.parse(nowIso)) {
        if (current.status !== "rejected") {
          this.#db
            .prepare("UPDATE actions SET status = 'expired' WHERE id = ?")
            .run(id);
          this.#audit("action.expired", "action", id, {}, nowIso);
        }
        postCommitError = new Error("Action approval has expired.");
        return;
      }

      const normalizedType = assertNonEmpty(type, "Action type")
        .toLowerCase()
        .replace(/\s+/g, "_");
      const suppliedHash = hashActionPayload(normalizedType, payload);
      if (
        normalizedType !== current.type ||
        suppliedHash !== current.payload_hash
      ) {
        throw new Error("Action type or payload does not match its approval.");
      }

      const expectedStatus =
        current.mode === POLICY_MODE.AUTONOMOUS ? "ready" : "approved";
      if (current.status !== expectedStatus) {
        throw new Error(`Action is not executable from status ${current.status}.`);
      }

      if (current.mode === POLICY_MODE.APPROVAL_REQUIRED) {
        if (!approvalToken || !current.approval_token_hash) {
          throw new Error("This action requires its one-time approval token.");
        }
        const suppliedTokenHash = createHash("sha256")
          .update(String(approvalToken))
          .digest();
        const expectedTokenHash = Buffer.from(
          current.approval_token_hash,
          "hex",
        );
        if (
          suppliedTokenHash.length !== expectedTokenHash.length ||
          !timingSafeEqual(suppliedTokenHash, expectedTokenHash)
        ) {
          throw new Error("Invalid approval token.");
        }
      }

      const result = this.#db
        .prepare(
          `UPDATE actions SET
             status = 'consumed',
             consumed_at = ?,
             approval_token_hash = NULL
           WHERE id = ? AND status = ?`,
        )
        .run(nowIso, id, expectedStatus);
      if (!result.changes) {
        throw new Error("Action approval was consumed by another worker.");
      }
      this.#audit(
        "action.consumed",
        "action",
        id,
        { payloadHash: current.payload_hash },
        nowIso,
      );
      consumed = this.getAction(id);
    });

    if (postCommitError) throw postCommitError;
    return consumed;
  }

  // Audit -------------------------------------------------------------------

  listAuditLog({ entityType, entityId, limit = 100 } = {}) {
    const conditions = [];
    const values = [];
    if (entityType) {
      conditions.push("entity_type = ?");
      values.push(entityType);
    }
    if (entityId) {
      conditions.push("entity_id = ?");
      values.push(entityId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    values.push(Math.max(1, Math.min(1_000, Math.trunc(limit))));
    return this.#db
      .prepare(
        `SELECT * FROM audit_log ${where}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(...values)
      .map(decodeAudit);
  }

  // Idempotent first-run seeding -------------------------------------------

  seed(seedData = {}, { onlyIfEmpty = true } = {}) {
    return this.#transaction(() => {
      const tableIsEmpty = (table) =>
        Number(this.#db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count) ===
        0;

      if (seedData.settings && (!onlyIfEmpty || tableIsEmpty("settings"))) {
        const entries = Array.isArray(seedData.settings)
          ? seedData.settings.map(({ key, value }) => [key, value])
          : Object.entries(seedData.settings);
        for (const [key, value] of entries) this.setSetting(key, value);
      }
      if (
        seedData.instructions &&
        (!onlyIfEmpty || tableIsEmpty("instructions"))
      ) {
        for (const instruction of seedData.instructions) {
          this.upsertInstruction(instruction);
        }
      }
      if (seedData.messages && (!onlyIfEmpty || tableIsEmpty("messages"))) {
        for (const message of seedData.messages) this.addMessage(message);
      }
      if (seedData.sources && (!onlyIfEmpty || tableIsEmpty("sources"))) {
        for (const source of seedData.sources) this.upsertSource(source);
      }
      if (
        seedData.intelItems &&
        (!onlyIfEmpty || tableIsEmpty("intel_items"))
      ) {
        for (const item of seedData.intelItems) this.upsertIntelItem(item);
      }
      if (seedData.briefings && (!onlyIfEmpty || tableIsEmpty("briefings"))) {
        for (const briefing of seedData.briefings) this.createBriefing(briefing);
      }
      if (seedData.jobs && (!onlyIfEmpty || tableIsEmpty("jobs"))) {
        for (const job of seedData.jobs) this.upsertJob(job);
      }
      return true;
    });
  }
}

/** Open (and migrate) a local brain database. */
export function openBrainDb({
  filename = resolve("data", "mei-ling.sqlite"),
  ...options
} = {}) {
  return new BrainDb(filename, options);
}
