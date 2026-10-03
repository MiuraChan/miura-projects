import { randomUUID } from "node:crypto";
import { buildEvidenceBackedBriefing } from "./briefing.mjs";
import {
  MIURA_RELEVANCE_PROFILE,
  SOURCE_URL_ALLOWLIST,
  getEnabledSources,
} from "./source-catalog.mjs";
import { fetchFeed, scoreItemRelevance } from "./rss.mjs";
import { isGamingEditorialResult } from "./live-search.mjs";

const HOUR_MS = 60 * 60 * 1_000;
const SCOUT_INTERVAL_MS = 4 * HOUR_MS;
const RETRY_INTERVAL_MS = 15 * 60 * 1_000;
const SCOUT_JOB_ID = "daily-intel-scout";
const SCOUT_JOB_TYPE = "research.public_game_news";

function zonedParts(date, timeZone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function localDateKey(date = new Date(), timeZone = "Europe/Rome") {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isQuietHours(
  date = new Date(),
  { timeZone = "Europe/Rome", startHour = 22, endHour = 8 } = {},
) {
  const hour = Number(zonedParts(date, timeZone).hour);
  return startHour > endHour
    ? hour >= startHour || hour < endHour
    : hour >= startHour && hour < endHour;
}

function freshnessUrgency(published, now) {
  const age = Math.max(0, now.getTime() - Date.parse(published || now));
  if (age <= 24 * HOUR_MS) return 0.95;
  if (age <= 72 * HOUR_MS) return 0.72;
  if (age <= 7 * 24 * HOUR_MS) return 0.48;
  return 0.2;
}

async function mapWithConcurrency(values, limit, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        output[index] = { status: "fulfilled", value: await worker(values[index], index) };
      } catch (reason) {
        output[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => runWorker()),
  );
  return output;
}

function publicBriefing(briefing) {
  if (!briefing) return null;
  const metadata = briefing.metadata || {};
  return {
    id: briefing.id,
    kind: briefing.kind,
    title: briefing.title,
    spokenSummary: metadata.spokenSummary || briefing.body,
    creatorAngle: metadata.creatorAngle || "",
    recordingMission: metadata.recordingMission || "",
    contentType: metadata.contentType || "news",
    sourceAssessment: metadata.sourceAssessment || "",
    sourceTier: metadata.sourceTier || "unknown",
    claimStatus: metadata.claimStatus || "reported",
    confidenceScore: Number(metadata.confidenceScore ?? 0),
    channelFitScore: Number(metadata.channelFitScore ?? 0),
    timelinessScore: Number(metadata.timelinessScore ?? 0),
    opportunityScore: Number(metadata.opportunityScore ?? 0),
    whyItMatters: metadata.whyItMatters || "",
    recommendation: metadata.recommendation || "monitor",
    evidence: Array.isArray(metadata.evidence) ? metadata.evidence : [],
    createdAt: briefing.created_at,
    readAt: briefing.read_at,
  };
}

export function createBrainScheduler({
  db,
  complete,
  emit = () => {},
  clock = () => new Date(),
  timeZone = "Europe/Rome",
  intervalMs = SCOUT_INTERVAL_MS,
  fetchFeedFn = fetchFeed,
  sourceProvider = getEnabledSources,
  initialDelayMs = 15_000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  if (!db) throw new TypeError("A brain database is required");
  if (typeof complete !== "function") throw new TypeError("A completion function is required");

  const workerId = `codec-${process.pid}-${randomUUID().slice(0, 8)}`;
  let timer = null;
  let startupTimer = null;
  let tickPromise = null;
  let scanPromise = null;

  function nowDate() {
    const value = clock();
    return value instanceof Date ? value : new Date(value);
  }

  function seedSources() {
    for (const source of sourceProvider()) {
      const existing = db.getSource(source.id);
      db.upsertSource({
        id: source.id,
        url: source.url,
        title: source.name,
        kind: source.kind,
        enabled: source.enabled !== false,
        trust: source.publisherType === "official" ? 0.92 : 0.68,
        metadata: {
          ...(existing?.metadata || {}),
          language: source.language,
          publisherType: source.publisherType,
          topics: source.topics,
          query: source.query || null,
        },
        lastCheckedAt: existing?.last_checked_at || null,
      });
    }
  }

  function initialize() {
    seedSources();
    if (!db.getJob(SCOUT_JOB_ID)) {
      db.upsertJob({
        id: SCOUT_JOB_ID,
        type: SCOUT_JOB_TYPE,
        payload: { access: "public-read-only" },
        schedule: "PT4H",
        priority: 10,
        nextRunAt: new Date(nowDate().getTime() + initialDelayMs),
      });
    }
  }

  async function fetchSource(source, scanStartedAt) {
    const stored = db.getSource(source.id);
    const action = db.requestAction({
      type: "research.public_feed",
      payload: { sourceId: source.id, url: source.url, method: "GET" },
      description: `Read public feed ${source.name}`,
    });
    db.consumeAction(action.id, {
      type: action.type,
      payload: action.payload,
    });

    try {
      const result = await fetchFeedFn(source, {
        timeoutMs: 15_000,
        maxBytes: 2_500_000,
        maxDescriptionChars: 1_800,
        etag: stored?.metadata?.etag || null,
        lastModified: stored?.metadata?.lastModified || null,
        allowedUrls: SOURCE_URL_ALLOWLIST,
      });
      db.upsertSource({
        id: source.id,
        url: source.url,
        title: source.name,
        kind: source.kind,
        enabled: true,
        trust: source.publisherType === "official" ? 0.92 : 0.68,
        metadata: {
          ...(stored?.metadata || {}),
          language: source.language,
          publisherType: source.publisherType,
          topics: source.topics,
          query: source.query || null,
          etag: result.etag || stored?.metadata?.etag || null,
          lastModified: result.lastModified || stored?.metadata?.lastModified || null,
          finalUrl: result.finalUrl || source.url,
          lastStatus: result.status,
          lastError: null,
        },
        lastCheckedAt: scanStartedAt,
      });

      if (result.notModified || !result.feed) {
        return { sourceId: source.id, fetched: 0, relevant: 0, notModified: true };
      }

      let relevant = 0;
      const items = result.feed.items.slice(0, 40);
      for (const item of items) {
        if (source.publisherType !== "official" && !isGamingEditorialResult({
          title: item.title,
          source: source.name,
          summary: item.summary,
        })) continue;
        const relevance = scoreItemRelevance(item, MIURA_RELEVANCE_PROFILE);
        if (!relevance.relevant) continue;
        relevant += 1;
        const existing = db.getIntelItem(item.id);
        db.upsertIntelItem({
          id: item.id,
          sourceId: source.id,
          externalId: item.contentHash,
          url: item.canonicalUrl || item.url,
          title: item.title,
          summary: item.summary,
          publishedAt: item.published || item.updated || null,
          discoveredAt: existing?.discovered_at || scanStartedAt,
          relevance: Math.min(1, relevance.score / 100),
          novelty: existing ? 0.12 : 1,
          confidence: source.publisherType === "official" ? 0.96 : 0.74,
          urgency: freshnessUrgency(item.published || item.updated, new Date(scanStartedAt)),
          tags: [...new Set([...(item.categories || []), ...relevance.reasons.map((entry) => entry.id)])],
          metadata: {
            sourceName: source.name,
            sourceKind: source.publisherType,
            canonicalUrl: item.canonicalUrl || item.url,
            contentHash: item.contentHash,
            relevanceScore: relevance.score,
            matchedKeywords: relevance.matchedKeywords,
            reasons: relevance.reasons,
          },
        });
      }
      return {
        sourceId: source.id,
        fetched: items.length,
        relevant,
        notModified: false,
      };
    } catch (error) {
      db.upsertSource({
        id: source.id,
        url: source.url,
        title: source.name,
        kind: source.kind,
        enabled: true,
        trust: source.publisherType === "official" ? 0.92 : 0.68,
        metadata: {
          ...(stored?.metadata || {}),
          language: source.language,
          publisherType: source.publisherType,
          topics: source.topics,
          query: source.query || null,
          lastError: String(error?.message || error).slice(0, 800),
        },
        lastCheckedAt: scanStartedAt,
      });
      throw error;
    }
  }

  function eligibleIntel(now) {
    const cutoff = now.getTime() - 8 * 24 * HOUR_MS;
    return db
      .listRankedIntel({ limit: 25, unreadOnly: true, now })
      .filter((item) => {
        const timestamp = Date.parse(item.published_at || item.discovered_at || 0);
        return !item.used_at && Number.isFinite(timestamp) && timestamp >= cutoff;
      })
      .slice(0, 8)
      .map((item) => ({
        ...item,
        sourceName: item.metadata?.sourceName || item.source_id,
        canonicalUrl: item.metadata?.canonicalUrl || item.url,
        relevanceScore: item.rank_score,
      }));
  }

  function emitBriefingIfEligible(briefing, now = nowDate()) {
    if (!briefing) return { emitted: false, reason: "missing" };
    const day = localDateKey(now, timeZone);
    if (isQuietHours(now, { timeZone })) {
      db.setSetting("pendingNotificationBriefingId", briefing.id);
      return { emitted: false, reason: "quiet-hours" };
    }
    if (db.getSetting("lastNotificationDate") === day) {
      return { emitted: false, reason: "daily-limit" };
    }

    const payload = { briefingId: briefing.id, day };
    const action = db.requestAction({
      type: "local.notification",
      payload,
      description: "Show one local Daily Intel notification",
    });
    db.consumeAction(action.id, {
      type: action.type,
      payload: action.payload,
    });
    const delivered = emit("briefing-ready", {
      id: briefing.id,
      title: briefing.title,
      spokenSummary: briefing.metadata?.spokenSummary || briefing.body,
      claimStatus: briefing.metadata?.claimStatus || "reported",
      confidenceScore: Number(briefing.metadata?.confidenceScore ?? 0),
      recommendation: briefing.metadata?.recommendation || "monitor",
    });
    if (!delivered) {
      db.setSetting("pendingNotificationBriefingId", briefing.id);
      return { emitted: false, reason: "no-listener" };
    }
    db.setSetting("lastNotificationDate", day);
    db.setSetting("pendingNotificationBriefingId", null);
    return { emitted: true, reason: "ready" };
  }

  function flushPendingNotification() {
    const pendingId = db.getSetting("pendingNotificationBriefingId");
    if (!pendingId) return { emitted: false, reason: "none" };
    return emitBriefingIfEligible(db.getBriefing(pendingId), nowDate());
  }

  async function executeScan({ force = false } = {}) {
    const started = nowDate();
    const startedAt = started.toISOString();
    const sources = sourceProvider().filter((source) => source.enabled !== false);
    const outcomes = await mapWithConcurrency(
      sources,
      4,
      (source) => fetchSource(source, startedAt),
    );

    const fulfilled = outcomes
      .filter((outcome) => outcome.status === "fulfilled")
      .map((outcome) => outcome.value);
    const failures = outcomes
      .filter((outcome) => outcome.status === "rejected")
      .map((outcome) => String(outcome.reason?.message || outcome.reason).slice(0, 300));
    const day = localDateKey(started, timeZone);
    const intel = eligibleIntel(started);
    const signature = intel.length
      ? intel.map((item) => item.id).join("|")
      : `evergreen:${day}`;
    const duplicate = !force && db.getSetting("lastBriefingDate") === day;

    let briefing = null;
    if (!duplicate) {
      const generated = await buildEvidenceBackedBriefing({
        items: intel,
        complete,
        now: started,
      });
      const evaluation = {
        contentType: generated.contentType,
        sourceAssessment: generated.sourceAssessment,
        sourceTier: generated.sourceTier,
        claimStatus: generated.claimStatus,
        confidenceScore: generated.confidenceScore,
        channelFitScore: generated.channelFitScore,
        timelinessScore: generated.timelinessScore,
        opportunityScore: generated.opportunityScore,
        whyItMatters: generated.whyItMatters,
        recommendation: generated.recommendation,
      };
      db.deleteBriefingsByKind("daily-intel");
      briefing = db.createBriefing({
        kind: "daily-intel",
        title: generated.headline,
        body: JSON.stringify({
          ...evaluation,
          creatorAngle: generated.creatorAngle,
          recordingMission: generated.recordingMission,
          evidence: generated.evidence,
        }),
        itemIds: generated.sourceIds,
        metadata: {
          ...evaluation,
          spokenSummary: generated.spokenSummary,
          creatorAngle: generated.creatorAngle,
          recordingMission: generated.recordingMission,
          evidence: generated.evidence,
          scannedAt: startedAt,
        },
      });
      for (const itemId of generated.sourceIds) {
        db.markIntelUsed(itemId, startedAt);
        db.markIntelRead(itemId, startedAt);
      }
      db.setSetting("lastBriefingDate", day);
      db.setSetting("lastBriefingSignature", signature);
      db.setSetting("pendingNotificationBriefingId", briefing.id);
      emitBriefingIfEligible(briefing, started);
    }

    const summary = {
      ok: fulfilled.length > 0,
      startedAt,
      completedAt: nowDate().toISOString(),
      sourceCount: sources.length,
      reachedSources: fulfilled.length,
      failedSources: failures.length,
      fetchedItems: fulfilled.reduce((sum, item) => sum + item.fetched, 0),
      relevantItems: fulfilled.reduce((sum, item) => sum + item.relevant, 0),
      briefing: publicBriefing(briefing),
      forced: force,
      duplicate,
      errors: failures.slice(0, 5),
    };
    db.setSetting("lastScanAt", summary.completedAt);
    db.setSetting("lastScanSummary", summary);
    return summary;
  }

  async function runScan(options = {}) {
    if (!scanPromise) {
      scanPromise = executeScan(options).finally(() => {
        scanPromise = null;
      });
    }
    return scanPromise;
  }

  async function tick() {
    flushPendingNotification();
    const jobs = db.acquireDueJobs(workerId, {
      now: nowDate(),
      leaseMs: 5 * 60 * 1_000,
      limit: 1,
    });
    for (const job of jobs) {
      try {
        if (job.type !== SCOUT_JOB_TYPE) throw new Error(`Unsupported job: ${job.type}`);
        const result = await runScan();
        db.completeJob(job.id, workerId, {
          result,
          nextRunAt: new Date(nowDate().getTime() + intervalMs),
        });
      } catch (error) {
        db.failJob(job.id, workerId, error, {
          retryAt: new Date(nowDate().getTime() + RETRY_INTERVAL_MS),
        });
      }
    }
  }

  function guardedTick() {
    if (!tickPromise) {
      tickPromise = tick()
        .catch((error) => {
          console.error("Daily Intel scheduler failed:", error?.message || error);
        })
        .finally(() => {
          tickPromise = null;
        });
    }
    return tickPromise;
  }

  function start() {
    if (timer || startupTimer) return;
    initialize();
    startupTimer = setTimeoutFn(() => {
      startupTimer = null;
      void guardedTick();
      timer = setIntervalFn(guardedTick, 30_000);
      timer.unref?.();
    }, initialDelayMs);
    startupTimer.unref?.();
  }

  function stop() {
    if (startupTimer) clearTimeoutFn(startupTimer);
    if (timer) clearIntervalFn(timer);
    startupTimer = null;
    timer = null;
  }

  function status() {
    const job = db.getJob(SCOUT_JOB_ID);
    return {
      internetAccess: "public-read-only",
      scheduler: timer || startupTimer ? "running" : "stopped",
      schedulerPhase: startupTimer ? "waiting" : timer ? "polling" : "stopped",
      backgroundStartDelayMs: initialDelayMs,
      intervalHours: intervalMs / HOUR_MS,
      quietHours: "22:00–08:00 Europe/Rome",
      nextScanAt: job?.next_run_at || null,
      lastScanAt: db.getSetting("lastScanAt"),
      lastScan: db.getSetting("lastScanSummary"),
      unreadBriefings: db.listUnreadBriefings({ limit: 200 }).length,
      approvalRequests: db.listPendingActions({ limit: 200 }).length,
      limitations: {
        appMustBeRunning: true,
        remotePhonePush: false,
        externalPublishing: false,
      },
    };
  }

  return {
    initialize,
    start,
    stop,
    runScan,
    flushPendingNotification,
    status,
    toPublicBriefing: publicBriefing,
  };
}
