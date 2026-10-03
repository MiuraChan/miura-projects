"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { setTimeout: delay } = require("node:timers/promises");
const { app } = require("electron");
const { buildEditPlan } = require("./edit-planner.cjs");

const execFileAsync = promisify(execFile);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function overlapSeconds(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function collectProcessOutput(executable, args, maxChars = 400000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-maxChars); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-maxChars); });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(stderr || `${path.basename(executable)} exited with code ${code}.`)));
  });
}

function parseSceneTimes(log) {
  return [...log.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
}

function parseSilences(log, duration) {
  const starts = [...log.matchAll(/silence_start:\s*([0-9]+(?:\.[0-9]+)?)/g)].map((match) => Number(match[1]));
  const ends = [...log.matchAll(/silence_end:\s*([0-9]+(?:\.[0-9]+)?)/g)].map((match) => Number(match[1]));
  return starts.map((start, index) => ({ start, end: Number.isFinite(ends[index]) ? ends[index] : duration }));
}

function parseSubtitleTime(value) {
  const match = String(value || "").trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{3})/);
  if (!match) return null;
  return (Number(match[1] || 0) * 3600) + (Number(match[2]) * 60) + Number(match[3]) + (Number(match[4]) / 1000);
}

function parseSubtitleCues(text) {
  const normalized = String(text || "").replace(/\r/g, "").replace(/^WEBVTT[^\n]*\n+/i, "");
  return normalized.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n").filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) return null;
    const [rawStart, rawEnd] = lines[timingIndex].split("-->").map((value) => value.trim().split(/\s+/)[0]);
    const start = parseSubtitleTime(rawStart);
    const end = parseSubtitleTime(rawEnd);
    const cueText = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    return Number.isFinite(start) && Number.isFinite(end) && end > start && cueText ? { start, end, text: cueText } : null;
  }).filter(Boolean);
}

function directionKeywords(direction) {
  const stop = new Set(["about", "after", "again", "alla", "anche", "before", "complete", "con", "conversation", "cut", "dialogue", "dopo", "end", "final", "finish", "full", "keep", "mantieni", "montaggio", "open", "prima", "remove", "risposta", "start", "the", "this", "video", "with", "without"]);
  return [...new Set(String(direction || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{4,}/g) || [])]
    .filter((word) => !stop.has(word))
    .slice(0, 16);
}

function extractDirectionRules(direction) {
  const clauses = String(direction || "")
    .split(/[.!?;\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const removePattern = /\b(remove|cut|skip|exclude|delete|drop|omit|togli|taglia|rimuovi|elimina|scarta|salta)\b|\b(not important|unimportant|non (?:e|è) importante)\b/i;
  const keepPattern = /\b(keep|focus|prioriti[sz]e|important|center on|preserve|mantieni|conserva|importante|concentrati|dai priorita|dai priorità)\b/i;
  return {
    mustRemove: clauses.filter((clause) => removePattern.test(clause)).slice(0, 12),
    mustKeep: clauses.filter((clause) => keepPattern.test(clause) && !removePattern.test(clause)).slice(0, 12),
  };
}

function normalizeVisionScore(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return clamp(Math.round(numeric > 0 && numeric <= 1 ? numeric * 100 : numeric), 0, 100);
}

function hasPositiveVisibleMatch(text, pattern) {
  const expression = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  for (const match of text.matchAll(expression)) {
    const prefix = text.slice(Math.max(0, match.index - 80), match.index);
    if (/(?:\bno\b|\bnot\b|without|does not|do not|no evidence of|no indication of|does not contain)[^.!?]{0,70}$/i.test(prefix)) continue;
    return true;
  }
  return false;
}

function enforceVisibleDirectionDecision(decision, confidence, reason, rules) {
  const visible = String(reason || "").toLowerCase();
  const removalBrief = (rules?.mustRemove || []).join(" ").toLowerCase();
  const removesGameplay = /game|gameplay|gioco/.test(removalBrief);
  const removesRewatch = /rewatch|re-watch|previous video|old episode|old video|video precedente|riguard|vecchi[oa]? episodi|episodio vecchio/.test(removalBrief);
  const directlyTalking = /direct-to-camera|speaking directly to (?:the )?camera/.test(visible);
  const explicitlyNoGameplay = /(?:no evidence|no indication|does not contain|without)[^.!?]{0,70}(?:gameplay|video game)/.test(visible);
  const explicitlyNoRewatch = /(?:no evidence|no indication|does not contain|without)[^.!?]{0,70}(?:replay|rewatch|old episode)/.test(visible);
  const explicitlyClear = (!removesGameplay || explicitlyNoGameplay) && (!removesRewatch || explicitlyNoRewatch);
  if (directlyTalking && explicitlyClear) return { decision: "keep", confidence: Math.max(82, confidence), enforcedBy: "visible-direct-camera-rule" };
  if (removesGameplay && hasPositiveVisibleMatch(visible, /gameplay|video game|in-game|combat|mission/i)) {
    return { decision: "remove", confidence: Math.max(85, confidence), enforcedBy: "visible-gameplay-rule" };
  }
  if (removesRewatch && hasPositiveVisibleMatch(visible, /old episode|previous video|video precedente|replay|previously recorded|recovery episode|episode 0|watching (?:a |the )?(?:youtube )?video|youtube video player|nested (?:video |twitch )?player/i)) {
    return { decision: "remove", confidence: Math.max(82, confidence), enforcedBy: "visible-rewatch-rule" };
  }
  return { decision, confidence, enforcedBy: null };
}
function buildTimelineWindows(duration, interval = 60) {
  const step = Math.max(20, Number(interval) || 60);
  const windows = [];
  for (let start = 0; start < duration; start += step) {
    const end = Math.min(duration, start + step);
    windows.push({ start, end, sampleAt: start + ((end - start) / 2) });
  }
  return windows.slice(0, 120);
}

function hasOpeningRemovalRule(rules) {
  return (rules?.mustRemove || []).some((rule) => /\b(first part|opening|at the start|beginning|intro|prima parte|all'inizio|inizio|apertura)\b/i.test(rule));
}

function buildDirectionAuditWindows(duration, rules) {
  const regular = buildTimelineWindows(duration, duration > 7200 ? 90 : 60);
  if (!hasOpeningRemovalRule(rules)) return regular;
  const detailedEnd = Math.min(duration, 12 * 60);
  const detailed = buildTimelineWindows(detailedEnd, 20);
  const openingOnly = (rules?.mustKeep || []).length === 0
    && (rules?.mustRemove || []).every((rule) => /\b(first part|opening|at the start|beginning|intro|prima parte|all'inizio|inizio|apertura)\b/i.test(rule));
  if (openingOnly) return detailed;
  const remainder = regular.filter((window) => window.start >= detailedEnd);
  return [...detailed, ...remainder].slice(0, 160);
}

function mergeExcludedTimelineRanges(reviews, minimumConfidence = 60, maximumGap = 5) {
  const ranges = reviews
    .filter((review) => review.decision === "remove" && Number(review.confidence) >= minimumConfidence)
    .map((review) => ({ start: Number(review.start), end: Number(review.end), reason: review.reason || "direction-match", enforcedBy: review.enforcedBy || null }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + Math.max(0, Number(maximumGap) || 0)) {
      previous.end = Math.max(previous.end, range.end);
      previous.reason = `${previous.reason}; ${range.reason}`.slice(0, 500);
    } else merged.push({ ...range });
  }
  return merged;
}

function readAssistantJson(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part) => typeof part === "string" ? part : part?.text || "").join("")
    : String(content || "");
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim() || "{}");
}

const lmStudioPreparedInstances = new Map();

async function lmStudioResponds(origin) {
  try {
    const response = await fetch(`${origin}/api/v1/models`, { signal: AbortSignal.timeout(4000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureLmStudioServer(endpoint) {
  const url = new URL(endpoint);
  const origin = url.origin;
  if (await lmStudioResponds(origin)) return false;
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return false;
  const executable = process.platform === "win32" ? "lms.exe" : "lms";
  const candidates = [
    process.env.GRAYFOX_LMS_PATH,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".lmstudio", "bin", executable) : null,
  ].filter(Boolean);
  const lmsPath = await candidates.reduce(async (foundPromise, candidate) => {
    const found = await foundPromise;
    if (found) return found;
    try { await fs.access(candidate); return candidate; } catch { return null; }
  }, Promise.resolve(null));
  if (!lmsPath) return false;
  try {
    await execFileAsync(lmsPath, ["server", "start"], { windowsHide: true, timeout: 30000 });
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await lmStudioResponds(origin)) return true;
    await delay(500);
  }
  return false;
}

async function prepareLmStudioVisionModel(endpoint, model) {
  if (lmStudioPreparedInstances.has(model)) return lmStudioPreparedInstances.get(model);
  const origin = new URL(endpoint).origin;
  try {
    const listResponse = await fetch(`${origin}/api/v1/models`, { signal: AbortSignal.timeout(15000) });
    if (!listResponse.ok) return model;
    const catalog = await listResponse.json();
    const entry = (catalog.models || []).find((item) => item.key === model);
    const suitable = entry?.loaded_instances?.find((instance) => Number(instance?.config?.context_length) >= 8192);
    if (suitable?.id) {
      lmStudioPreparedInstances.set(model, suitable.id);
      return suitable.id;
    }
    const loadResponse = await fetch(`${origin}/api/v1/models/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, context_length: 8192, flash_attention: true }),
      signal: AbortSignal.timeout(180000),
    });
    if (!loadResponse.ok) return model;
    const loaded = await loadResponse.json();
    const instanceId = loaded.instance_id || model;
    lmStudioPreparedInstances.set(model, instanceId);
    return instanceId;
  } catch {
    return model;
  }
}
async function requestLmStudioJson({ prompt, images, schema, schemaName, timeout = 240000 }) {
  const model = process.env.GRAYFOX_LM_STUDIO_MODEL || "qwen/qwen3-vl-4b";
  const endpoint = process.env.GRAYFOX_LM_STUDIO_URL || "http://127.0.0.1:1234/v1/chat/completions";
  if (await ensureLmStudioServer(endpoint)) lmStudioPreparedInstances.clear();
  const inferenceModel = await prepareLmStudioVisionModel(endpoint, model);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: inferenceModel,
      temperature: 0.05,
      // Qwen3-VL can produce a valid, schema-constrained answer that is still
      // longer than 1,200 tokens. Truncating it here silently disabled vision
      // analysis because the JSON parser saw an unterminated final string.
      max_tokens: 2800,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...images.map((image) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } })),
        ],
      }],
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      },
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`LM Studio returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return { model, payload: readAssistantJson(await response.json()) };
}

const memeRankingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "reason"],
        properties: {
          id: { type: "string", maxLength: 80 },
          reason: { type: "string", maxLength: 140 },
        },
      },
    },
  },
};

async function requestLmStudioMemeRanking(query, candidates) {
  const catalog = candidates.map((candidate) => `${candidate.id}: ${candidate.label} — ${candidate.description}; keywords: ${candidate.keywords.join(", ")}`).join("\n");
  const result = await requestLmStudioJson({
    prompt: `You rank Grayfox's built-in visual meme overlays for a user's search. Interpret English and Italian intent, emotion, reaction and storytelling language. Return only IDs from the supplied catalog, ordered best first. Never invent a meme or claim an external media asset exists.\nUSER SEARCH: ${query}\nCATALOG:\n${catalog}`,
    images: [],
    schema: memeRankingSchema,
    schemaName: "grayfox_meme_ranking",
    timeout: 20000,
  });
  const allowed = new Set(candidates.map((candidate) => candidate.id));
  const seen = new Set();
  const results = (result.payload.results || []).filter((item) => allowed.has(item.id) && !seen.has(item.id) && seen.add(item.id));
  if (!results.length) throw new Error("LM Studio returned no usable meme IDs.");
  return { provider: "lm-studio", model: result.model, results };
}

const timelineReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reviews"],
  properties: {
    reviews: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "decision", "confidence", "semanticScore", "memeScore", "reason"],
        properties: {
          index: { type: "integer" },
          decision: { type: "string", enum: ["keep", "remove", "neutral"] },
          confidence: { type: "number", minimum: 0, maximum: 100 },
          semanticScore: { type: "number", minimum: 0, maximum: 100 },
          memeScore: { type: "number", minimum: 0, maximum: 100 },
          reason: { type: "string", maxLength: 140 },
        },
      },
    },
  },
};

const candidateRankingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rankings"],
  properties: {
    rankings: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "semanticScore", "memeScore", "title", "rationale", "memeReason"],
        properties: {
          index: { type: "integer" },
          semanticScore: { type: "number", minimum: 0, maximum: 100 },
          memeScore: { type: "number", minimum: 0, maximum: 100 },
          title: { type: "string", maxLength: 80 },
          rationale: { type: "string", maxLength: 180 },
          memeReason: { type: "string", maxLength: 180 },
        },
      },
    },
  },
};

function timelineReviewPrompt(windows, rules, brief) {
  return `You are the compliance editor for a long-form video. The supplied contact sheet contains visibly numbered chronological timeline samples in row-major order. The user instructions are binding.
MUST REMOVE: ${rules.mustRemove.join(" | ") || "none"}
MUST KEEP/PRIORITIZE: ${rules.mustKeep.join(" | ") || "none"}
FULL BRIEF AND VERIFIED TRANSCRIPT EXCERPTS: ${brief || "none"}
Indexes: ${windows.map((window, index) => `${index}=${window.start.toFixed(1)}-${window.end.toFixed(1)}s`).join(", ")}.
Classify what is visibly happening. A creator watching a nested Twitch/video player, an earlier recording, replay or previous episode is different from speaking directly to camera. Gameplay is different from direct-to-camera storytelling. If the instruction says first part, opening or beginning, remove matching consecutive opening samples until the content clearly changes; do not remove later direct-to-camera content. Use supplied transcript excerpts as evidence, never invent dialogue. Return exactly one review for every index.`;
}

async function requestLmStudioTimelineReview(windows, images, rules, brief) {
  const result = await requestLmStudioJson({
    prompt: timelineReviewPrompt(windows, rules, brief),
    images,
    schema: timelineReviewSchema,
    schemaName: "grayfox_timeline_review",
  });
  if (!Array.isArray(result.payload.reviews)) throw new Error("LM Studio returned an invalid timeline review.");
  return { model: result.model, provider: "lm-studio-qwen3-vl", reviews: result.payload.reviews };
}
async function requestOllamaTimelineReview(windows, images, rules, brief) {
  const model = process.env.GRAYFOX_OLLAMA_MODEL || "qwen3-vl:2b-instruct";
  const response = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature: 0.05, num_ctx: 8192, num_predict: 1400 },
      messages: [{
        role: "user",
        content: `You are the compliance editor for a long-form video. The supplied contact sheet contains visibly numbered chronological timeline samples in row-major order. The user instructions are binding.\nMUST REMOVE: ${rules.mustRemove.join(" | ") || "none"}\nMUST KEEP/PRIORITIZE: ${rules.mustKeep.join(" | ") || "none"}\nFULL BRIEF: ${brief || "none"}\nIndexes: ${windows.map((window, index) => `${index}=${Math.round(window.start)}-${Math.round(window.end)}s`).join(", ")}.\nClassify what is visibly happening. A creator watching a nested Twitch/video player, an old episode, replay or previously recorded program is different from the creator speaking directly to camera. Gameplay is different from direct-to-camera storytelling. Mark remove only when the visible evidence matches a MUST REMOVE rule. Mark keep when it matches a MUST KEEP rule. Otherwise neutral. Never infer spoken words.\nReturn exactly one review for every supplied index, with no omissions. Return JSON only: {"reviews":[{"index":0,"decision":"keep|remove|neutral","confidence":0,"semanticScore":0,"memeScore":0,"reason":"max eight grounded words"}]}.`,
        images,
      }],
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`Timeline vision returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json();
  const parsed = JSON.parse(payload?.message?.content || "{}");
  if (!Array.isArray(parsed.reviews)) throw new Error("Timeline vision returned an invalid review.");
  return { model, reviews: parsed.reviews };
}

function applyMemeBeats(editPlan, reviews, maximum = 3) {
  if (!editPlan?.segments?.length) return 0;
  const minimumScore = clamp(Number(editPlan.toneProfile?.memeThreshold) || 78, 1, 100);
  const ranked = reviews
    .filter((review) => review.decision !== "remove" && Number(review.memeScore) >= minimumScore)
    .sort((a, b) => Number(b.memeScore) - Number(a.memeScore));
  let applied = 0;
  for (const review of ranked) {
    const segment = editPlan.segments.find((item) => overlapSeconds(item.start, item.end, review.start, review.end) >= 1);
    if (!segment || segment.effect || segment.end - segment.start < 2) continue;
    segment.effect = "meme-punch";
    segment.memeEnabled = true;
    segment.memeSuggested = true;
    segment.memeStart = Number(Math.max(segment.start, review.start).toFixed(3));
    segment.memeEnd = Number(Math.min(segment.end, segment.memeStart + 1.2).toFixed(3));
    segment.memeReason = String(review.reason || "High-confidence visual reaction beat").slice(0, 300);
    applied += 1;
    if (applied >= maximum) break;
  }
  return applied;
}
function applyDialogueContext(candidates, dialogueCues, direction) {
  const keywords = directionKeywords(direction);
  for (const candidate of candidates) {
    const cues = dialogueCues.filter((cue) => overlapSeconds(candidate.start, candidate.end, cue.start, cue.end) > 0);
    const excerpt = cues.map((cue) => cue.text).join(" ").replace(/\s+/g, " ").trim().slice(0, 320);
    const normalized = excerpt.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const matches = keywords.filter((keyword) => normalized.includes(keyword));
    candidate.dialogueExcerpt = excerpt || null;
    candidate.dialogueMatches = matches;
    if (matches.length) {
      candidate.score = clamp(candidate.score + Math.min(40, 22 + (matches.length * 8)), 1, 100);
      candidate.note = `${candidate.note} · direction dialogue match: ${matches.join(", ")}`;
    } else if (excerpt) {
      candidate.score = clamp(candidate.score + 3, 1, 100);
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

async function loadDialogueCues(sourcePath, ffmpegPath, temporaryDirectory, explicitTranscriptPath = null) {
  if (explicitTranscriptPath) {
    try {
      const transcriptExtension = path.extname(explicitTranscriptPath).toLowerCase();
      if (![".srt", ".vtt"].includes(transcriptExtension)) throw new Error("Only .srt and .vtt transcripts are supported.");
      const cues = parseSubtitleCues(await fs.readFile(explicitTranscriptPath, "utf8"));
      if (cues.length) return { provider: `attached-${transcriptExtension.slice(1)}`, cues, fallbackReason: null };
      throw new Error("No timed dialogue cues were found.");
    } catch (error) {
      return { provider: "speech-activity-only", cues: [], fallbackReason: `Attached transcript failed: ${error.message}` };
    }
  }
  const parsed = path.parse(sourcePath);
  for (const extension of [".srt", ".vtt"]) {
    const sidecarPath = path.join(parsed.dir, `${parsed.name}${extension}`);
    try {
      const cues = parseSubtitleCues(await fs.readFile(sidecarPath, "utf8"));
      if (cues.length) return { provider: `sidecar-${extension.slice(1)}`, cues, fallbackReason: null };
    } catch { /* Try embedded subtitles next. */ }
  }
  try {
    const { stdout } = await execFileAsync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", sourcePath, "-map", "0:s:0", "-f", "srt", "-"], { windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
    const cues = parseSubtitleCues(stdout);
    if (cues.length) return { provider: "embedded-subtitles", cues, fallbackReason: null };
  } catch { /* No embedded subtitle stream. */ }

  const whisperPath = process.env.GRAYFOX_WHISPER_PATH;
  const whisperModel = process.env.GRAYFOX_WHISPER_MODEL;
  if (whisperPath && whisperModel) {
    try {
      await fs.mkdir(temporaryDirectory, { recursive: true });
      const audioPath = path.join(temporaryDirectory, "dialogue.wav");
      const outputBase = path.join(temporaryDirectory, "whisper-dialogue");
      await execFileAsync(ffmpegPath, ["-y", "-i", sourcePath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audioPath], { windowsHide: true, timeout: 600000 });
      await execFileAsync(whisperPath, ["-m", whisperModel, "-f", audioPath, "-oj", "-of", outputBase], { windowsHide: true, timeout: 3600000, maxBuffer: 4 * 1024 * 1024 });
      const payload = JSON.parse(await fs.readFile(`${outputBase}.json`, "utf8"));
      const cues = (payload.transcription || payload.segments || []).map((item) => ({
        start: Number(item.offsets?.from ?? item.start ?? 0) / (item.offsets?.from != null ? 1000 : 1),
        end: Number(item.offsets?.to ?? item.end ?? 0) / (item.offsets?.to != null ? 1000 : 1),
        text: String(item.text || "").trim(),
      })).filter((cue) => cue.text && cue.end > cue.start);
      if (cues.length) return { provider: "whisper-local", cues, fallbackReason: null };
    } catch (error) {
      return { provider: "speech-activity-only", cues: [], fallbackReason: `Local Whisper failed: ${error.message}` };
    }
  }
  return { provider: "speech-activity-only", cues: [], fallbackReason: "No subtitles or configured local Whisper model were available." };
}

function buildSignalCandidates({
  duration,
  targetLength,
  sceneTimes = [],
  silences = [],
  tone = "",
  finalUse = "",
  direction = "",
  dialogueCues = [],
  limit = 8,
}) {
  const length = clamp(Number(targetLength) || 30, 3, duration);
  const latestStart = Math.max(0, duration - length);
  const regular = duration <= length
    ? [0]
    : Array.from({ length: 8 }, (_value, index) => latestStart * (index / 7));
  const sceneStarts = sceneTimes.map((time) => clamp(time - Math.min(2, length * 0.08), 0, latestStart));
  const keywords = directionKeywords(direction);
  const dialogueStarts = dialogueCues.filter((cue) => !keywords.length || keywords.some((keyword) => cue.text.toLowerCase().includes(keyword))).map((cue) => clamp(cue.start - Math.min(2, length * 0.12), 0, latestStart));
  const starts = [...new Set([...regular, ...sceneStarts, ...dialogueStarts].map((value) => Number(value.toFixed(1))))]
    .sort((a, b) => a - b)
    .filter((value, index, values) => index === 0 || value - values[index - 1] >= Math.min(2, length * 0.12));
  const brief = `${tone} ${finalUse} ${direction}`.toLowerCase();
  const energetic = /(energetic|dynamic|bold|fast|punchy|exciting|event|highlight|action|meme|funny)/.test(brief);
  const calm = /(warm|premium|calm|cinematic|elegant|thoughtful|emotional)/.test(brief);
  const direct = /(direct|concise|short|clear|helpful|tutorial|result|reveal|hook)/.test(brief);

  const ranked = starts.map((start) => {
    const end = Math.min(duration, start + length);
    const actualLength = end - start;
    const cuts = sceneTimes.filter((time) => time >= start && time < end).length;
    const quietSeconds = silences.reduce(
      (total, silence) => total + overlapSeconds(start, end, silence.start, silence.end),
      0
    );
    const quietRatio = clamp(quietSeconds / actualLength, 0, 1);
    const cutRate = cuts / Math.max(actualLength / 60, 0.1);
    const pace = clamp(cutRate / 14, 0, 1);
    const clarity = 1 - quietRatio;
    const hook = 1 - (start / Math.max(duration, 1));
    let score = 42 + (clarity * 24) + (hook * 8);
    if (energetic) score += pace * 22;
    else if (calm) score += (1 - Math.abs(pace - 0.35)) * 18;
    else score += (1 - Math.abs(pace - 0.55)) * 14;
    if (direct) score += clarity * 10;
    const memeScore = clamp(Math.round(35 + (pace * 35) + (clarity * 20)), 0, 100);
    return {
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      score: clamp(Math.round(score), 1, 99),
      memeScore,
      metrics: {
        cuts,
        cutRate: Number(cutRate.toFixed(2)),
        quietRatio: Number(quietRatio.toFixed(3)),
      },
      title: cuts
        ? `Active sequence with ${cuts} visual change${cuts === 1 ? "" : "s"}`
        : "Continuous visual sequence",
      note: `${cuts} detected scene changes · ${Math.round(quietRatio * 100)}% quiet audio`,
      memeReason: memeScore >= 65
        ? "Strong visual-change and reaction-window signal."
        : "Moderate meme signal; review the visual beat.",
    };
  });
  return applyDialogueContext(ranked, dialogueCues, direction).slice(0, limit);
}

async function extractCandidateFrames(sourcePath, candidates, ffmpegPath, temporaryDirectory) {
  await fs.mkdir(temporaryDirectory, { recursive: true });
  const images = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const timestamp = Number.isFinite(candidate.sampleAt)
      ? candidate.sampleAt
      : candidate.start + Math.min(3, Math.max(0.2, (candidate.end - candidate.start) / 2));
    const framePath = path.join(temporaryDirectory, `candidate-${index}.jpg`);
    await execFileAsync(ffmpegPath, [
      "-y", "-ss", String(timestamp), "-i", sourcePath,
      "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", framePath,
    ], { windowsHide: true });
    images.push((await fs.readFile(framePath)).toString("base64"));
  }
  return images;
}

async function createFrameContactSheet(imageCount, ffmpegPath, temporaryDirectory, name = "contact-sheet") {
  if (imageCount <= 1) {
    const only = await fs.readFile(path.join(temporaryDirectory, "candidate-0.jpg"));
    return [only.toString("base64")];
  }
  const columns = Math.min(3, imageCount);
  const inputs = [];
  const filters = [];
  const labels = [];
  for (let index = 0; index < imageCount; index += 1) {
    inputs.push("-i", path.join(temporaryDirectory, `candidate-${index}.jpg`));
    filters.push(`[${index}:v]scale=320:-2,pad=320:200:0:(200-ih)/2:color=white,drawtext=text='${index}':x=8:y=8:fontsize=22:fontcolor=0xC41E1E:box=1:boxcolor=white@0.85[v${index}]`);
    labels.push(`[v${index}]`);
  }
  const layout = Array.from({ length: imageCount }, (_value, index) => `${(index % columns) * 320}_${Math.floor(index / columns) * 200}`).join("|");
  const outputPath = path.join(temporaryDirectory, `${name}.jpg`);
  await execFileAsync(ffmpegPath, [
    "-y", ...inputs,
    "-filter_complex", `${filters.join(";")};${labels.join("")}xstack=inputs=${imageCount}:layout=${layout}[sheet]`,
    "-map", "[sheet]", "-frames:v", "1", "-update", "1", "-q:v", "4", outputPath,
  ], { windowsHide: true, timeout: 120000 });
  return [(await fs.readFile(outputPath)).toString("base64")];
}
async function requestLmStudioVision(candidates, images, brief) {
  const result = await requestLmStudioJson({
    prompt: `You are Grayfox, a practical video editor. Rank these candidate frames for this brief: ${brief || "find the strongest self-contained moment"}.
The supplied contact sheet contains candidate tiles in row-major order, visibly numbered ${candidates.map((_candidate, index) => index).join(", ")}.
Use scores from 0 to 100. Return one compact entry per numbered tile and keep every explanation to one short sentence. Never invent dialogue or audio. Use only supplied transcript evidence. Evaluate visible subject, action, emotion, clarity, hook, direction match and brand safety. Meme score only describes whether a beat could work with a user-selected meme template; do not insert an effect.`,
    images,
    schema: candidateRankingSchema,
    schemaName: "grayfox_candidate_ranking",
  });
  if (!Array.isArray(result.payload.rankings)) throw new Error("LM Studio returned an invalid candidate ranking.");
  return { model: result.model, provider: "lm-studio-qwen3-vl", rankings: result.payload.rankings };
}

async function requestLocalVision(candidates, images, brief) {
  try {
    return await requestLmStudioVision(candidates, images, brief);
  } catch (lmStudioError) {
    try {
      const result = await requestOllamaVision(candidates, images, brief);
      return { ...result, provider: "ollama-vision" };
    } catch (ollamaError) {
      throw new Error(`LM Studio unavailable: ${lmStudioError.message} Ollama unavailable: ${ollamaError.message}`);
    }
  }
}

async function requestLocalTimelineReview(windows, images, rules, brief) {
  try {
    return await requestLmStudioTimelineReview(windows, images, rules, brief);
  } catch (lmStudioError) {
    try {
      const result = await requestOllamaTimelineReview(windows, images, rules, brief);
      return { ...result, provider: "ollama-vision-timeline" };
    } catch (ollamaError) {
      throw new Error(`LM Studio unavailable: ${lmStudioError.message} Ollama unavailable: ${ollamaError.message}`);
    }
  }
}
async function requestOllamaVision(candidates, images, brief) {
  const model = process.env.GRAYFOX_OLLAMA_MODEL || "qwen3-vl:2b-instruct";
  const response = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature: 0.15, num_ctx: 8192 },
      messages: [{
        role: "user",
        content: `You are Grayfox, a practical video editor. Rank these candidate frames for this brief: ${brief || "find the strongest self-contained moment"}.
The supplied contact sheet contains candidate tiles in row-major order, visibly numbered ${candidates.map((_candidate, index) => index).join(", ")}.
Return JSON only: {"rankings":[{"index":0,"semanticScore":0,"memeScore":0,"title":"short factual title","rationale":"one grounded sentence","memeReason":"one sentence about reaction face, irony, punchline, or text-overlay potential"}]}.
Use scores from 0 to 100. Never invent dialogue or audio. When the brief includes dialogue evidence, use only that supplied text. Evaluate visible subject, action, emotion, clarity, hook, direction match, brand safety, and meme potential.`,
        images,
      }],
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Local vision model returned HTTP ${response.status}: ${detail}`);
  }
  const payload = await response.json();
  const parsed = JSON.parse(payload?.message?.content || "{}");
  if (!Array.isArray(parsed.rankings)) throw new Error(`Local vision model returned an invalid ranking: ${(payload?.message?.content || "").slice(0, 500)}`);
  return { model, rankings: parsed.rankings };
}

function timelineDialogueEvidence(windows, cues) {
  return windows.map((window, index) => {
    const excerpt = cues
      .filter((cue) => overlapSeconds(window.start, window.end, cue.start, cue.end) > 0)
      .map((cue) => cue.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    return `${index}=${excerpt || "none"}`;
  }).join(" | ");
}
function createLocalAi({ resolveMediaTool, probeDuration, cleanText }) {
  async function rankMemes(_event, payload) {
    const query = cleanText(payload?.query, "", 180);
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates.slice(0, 12).map((candidate) => ({
      id: cleanText(candidate?.id, "", 80),
      label: cleanText(candidate?.label, "", 100),
      description: cleanText(candidate?.description, "", 180),
      keywords: Array.isArray(candidate?.keywords) ? candidate.keywords.slice(0, 20).map((keyword) => cleanText(keyword, "", 60)).filter(Boolean) : [],
    })).filter((candidate) => candidate.id && candidate.label) : [];
    if (!query || !candidates.length) return { provider: "local-keywords", model: null, results: [] };
    try {
      return await requestLmStudioMemeRanking(query, candidates);
    } catch (error) {
      return {
        provider: "local-keywords",
        model: null,
        results: [],
        fallbackReason: cleanText(error?.message, "LM Studio unavailable.", 300),
      };
    }
  }

  async function analyzeVideo(_event, payload) {
    const sourcePath = cleanText(payload?.sourcePath, "", 2000);
    if (!path.isAbsolute(sourcePath)) throw new Error("Choose a local source video before analysis.");
    await fs.access(sourcePath);
    const reportProgress = (percent, phase, detail) => _event?.sender?.send?.("video:production-progress", { percent, phase, detail });
    reportProgress(2, "analysis-start", "Reading the full source duration");
    const ffmpegPath = await resolveMediaTool("ffmpeg");
    const ffprobePath = await resolveMediaTool("ffprobe");
    const duration = await probeDuration(sourcePath, ffprobePath);
    const requestedTarget = clamp(Number(payload?.targetLength) || 30, 3, duration);
    const minimumDuration = clamp(Number(payload?.minimumDuration) || requestedTarget, 3, duration);
    const maximumDuration = clamp(Number(payload?.maximumDuration) || requestedTarget, minimumDuration, duration);
    const targetLength = maximumDuration;
    const mode = payload?.mode === "edit" ? "edit" : "clips";
    const candidateLength = mode === "edit"
      ? clamp(Number(payload?.segmentLength) || Math.min(12, targetLength / 3), 4, Math.min(20, duration))
      : targetLength;
    const shouldScanEveryFrame = mode !== "edit" || duration <= 600;
    const [sceneResult, silenceResult] = await Promise.all([
      shouldScanEveryFrame
        ? collectProcessOutput(ffmpegPath, [
          "-hide_banner", "-i", sourcePath,
          "-vf", "select=gt(scene\\,0.22),showinfo", "-an", "-f", "null", "-",
        ])
        : Promise.resolve({ stdout: "", stderr: "" }),
      collectProcessOutput(ffmpegPath, [
        "-hide_banner", "-i", sourcePath,
        "-af", "silencedetect=noise=-35dB:d=0.35", "-vn", "-f", "null", "-",
      ]),
    ]);
    reportProgress(10, "signal-scan", "Audio pauses and visual signals measured");
    const sceneTimes = parseSceneTimes(sceneResult.stderr);
    const silences = parseSilences(silenceResult.stderr, duration);
    const temporaryDirectory = path.join(app.getPath("temp"), `grayfox-analysis-${process.pid}-${Date.now()}`);
    const direction = cleanText(payload?.direction, "", 5000);
    const dialogue = await loadDialogueCues(
      sourcePath,
      ffmpegPath,
      temporaryDirectory,
      cleanText(payload?.transcriptPath, "", 2000) || null
    );
    const preserveNaturalPauses = /(keep|preserve|natural|mantieni|conserva).{0,24}(pause|pauses|silence|silenzi|pause)/i.test(direction);
    const editingSilences = preserveNaturalPauses ? silences.filter((silence) => silence.end - silence.start >= 2.5) : silences;
    const candidates = buildSignalCandidates({
      duration,
      targetLength: candidateLength,
      sceneTimes,
      silences,
      tone: cleanText(payload?.tone, "", 500),
      finalUse: cleanText(payload?.finalUse, "", 100),
      direction,
      dialogueCues: dialogue.cues,
      limit: 6,
    });
    let provider = "local-signals";
    let model = null;
    let fallbackReason = null;
    const directionRules = extractDirectionRules(direction);
    const timelineReviews = [];
    let excludedRanges = [];
    try {
      const images = await extractCandidateFrames(sourcePath, candidates, ffmpegPath, temporaryDirectory);
      const visionImages = await createFrameContactSheet(images.length, ffmpegPath, temporaryDirectory, "candidate-sheet");
      const vision = await requestLocalVision(
        candidates,
        visionImages,
        `${payload?.finalUse || ""}; ${payload?.tone || ""}; ${direction}; dialogue evidence: ${candidates.map((candidate, index) => `${index}: ${candidate.dialogueExcerpt || "none"}`).join(" | ")}`
      );
      provider = vision.provider;
      model = vision.model;
      for (const ranking of vision.rankings) {
        const candidate = candidates[Number(ranking.index)];
        if (!candidate) continue;
        const semanticScore = clamp(Number(ranking.semanticScore) || candidate.score, 0, 100);
        candidate.score = Math.round((candidate.score * 0.35) + (semanticScore * 0.65));
        candidate.memeScore = clamp(Math.round(Number(ranking.memeScore) || candidate.memeScore), 0, 100);
        candidate.title = cleanText(ranking.title, candidate.title, 100);
        candidate.note = cleanText(ranking.rationale, candidate.note, 300);
        candidate.memeReason = cleanText(ranking.memeReason, candidate.memeReason, 300);
      }
      candidates.sort((a, b) => b.score - a.score);
    } catch (error) {
      fallbackReason = cleanText(error?.message, "Local vision model unavailable.", 500);
      if (candidates[0]) candidates[0].note = `${candidates[0].note}. Vision model unavailable; ranked from measured scene and audio signals.`;
    }

    if (mode === "edit" && (directionRules.mustRemove.length || directionRules.mustKeep.length)) {
      const windows = buildDirectionAuditWindows(duration, directionRules);
      const auditFailures = [];
      const reviewedStarts = new Set();
      const appendReviews = (items, sourceBatch) => {
        for (const item of items || []) {
          const window = sourceBatch[Number(item.index)];
          if (!window || reviewedStarts.has(window.start)) continue;
          const normalizedDecision = String(item.decision || "").trim().toLowerCase();
          const modelDecision = ["keep", "remove", "neutral"].includes(normalizedDecision) ? normalizedDecision : "neutral";
          const reason = cleanText(item.reason, "Visual timeline classification", 300);
          const enforced = enforceVisibleDirectionDecision(
            modelDecision,
            normalizeVisionScore(item.confidence),
            reason,
            directionRules
          );
          timelineReviews.push({
            start: window.start,
            end: window.end,
            decision: enforced.decision,
            confidence: enforced.confidence,
            semanticScore: normalizeVisionScore(item.semanticScore, 50),
            memeScore: normalizeVisionScore(item.memeScore),
            reason,
            enforcedBy: enforced.enforcedBy,
          });
          reviewedStarts.add(window.start);
        }
      };
      for (let offset = 0; offset < windows.length; offset += 8) {
        const batch = windows.slice(offset, offset + 8);
        let images = [];
        try {
          images = await extractCandidateFrames(sourcePath, batch, ffmpegPath, temporaryDirectory);
          const timelineImages = await createFrameContactSheet(images.length, ffmpegPath, temporaryDirectory, `timeline-sheet-${offset}`);
          const review = await requestLocalTimelineReview(
            batch,
            timelineImages,
            directionRules,
            `${payload?.finalUse || ""}; ${payload?.tone || ""}; ${direction}; timed transcript: ${timelineDialogueEvidence(batch, dialogue.cues)}`
          );
          model = review.model;
          provider = review.provider;
          appendReviews(review.reviews, batch);
        } catch (error) {
          if (!images.length) {
            auditFailures.push(`batch ${offset / 8 + 1} frame extraction: ${cleanText(error?.message, "unavailable", 160)}`);
            continue;
          }
        }
        const missing = batch.map((window, index) => ({ window, image: images[index] }))
          .filter((entry) => !reviewedStarts.has(entry.window.start));
        for (const entry of missing) {
          let lastError = null;
          for (let attempt = 0; attempt < 2 && !reviewedStarts.has(entry.window.start); attempt += 1) {
            try {
              const retry = await requestLocalTimelineReview(
                [entry.window],
                [entry.image],
                directionRules,
                `${payload?.finalUse || ""}; ${payload?.tone || ""}; ${direction}; timed transcript: ${timelineDialogueEvidence([entry.window], dialogue.cues)}`
              );
              model = retry.model;
              provider = retry.provider;
              appendReviews(retry.reviews, [entry.window]);
            } catch (error) {
              lastError = error;
            }
          }
          if (!reviewedStarts.has(entry.window.start)) {
            auditFailures.push(`sample ${Math.round(entry.window.start)}s: ${cleanText(lastError?.message, "missing model decision", 160)}`);
          }
        }
        reportProgress(12 + Math.round(((offset + batch.length) / windows.length) * 33), "direction-audit", `Reviewed ${reviewedStarts.size} of ${windows.length} timeline samples`);
      }
      excludedRanges = mergeExcludedTimelineRanges(
        timelineReviews,
        60,
        hasOpeningRemovalRule(directionRules) ? 25 : 5
      );
      if (auditFailures.length) fallbackReason = [fallbackReason, `Direction audit warnings: ${auditFailures.join("; ")}`].filter(Boolean).join(" ").slice(0, 1000);
    }
    const planningCandidates = [...candidates, ...timelineReviews
      .filter((review) => review.decision !== "remove")
      .map((review) => ({
        start: review.start,
        end: review.end,
        score: review.decision === "keep" ? Math.max(80, review.semanticScore) : review.semanticScore,
        memeScore: review.memeScore,
        title: review.decision === "keep" ? "Direction-matched timeline moment" : "Reviewed timeline moment",
        note: review.reason,
      }))].sort((a, b) => b.score - a.score);
    const editPlan = mode === "edit" ? buildEditPlan({
      candidates: planningCandidates,
      silences: editingSilences,
      dialogueCues: dialogue.cues,
      sourceDuration: duration,
      desiredDuration: targetLength,
      minimumDuration,
      maximumDuration,
      direction,
      tone: cleanText(payload?.tone, "", 500),
      excludedRanges,
    }) : null;
    const memeBeatCount = applyMemeBeats(editPlan, timelineReviews);
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    return {
      duration,
      targetLength,
      minimumDuration,
      maximumDuration,
      provider,
      model,
      editPlan,
      toneProfile: editPlan?.toneProfile || null,
      fallbackReason,
      directionRules,
      excludedRanges,
      directionAuditCount: timelineReviews.length,
      directionAuditExpected: mode === "edit" && (directionRules.mustRemove.length || directionRules.mustKeep.length) ? buildDirectionAuditWindows(duration, directionRules).length : 0,
      directionAuditCoverage: mode === "edit" && (directionRules.mustRemove.length || directionRules.mustKeep.length)
        ? Number((timelineReviews.length / buildDirectionAuditWindows(duration, directionRules).length).toFixed(3))
        : 1,
      memeBeatCount,
      timelineReviews,
      dialogueProvider: dialogue.provider,
      dialogueCueCount: dialogue.cues.length,
      dialogueFallbackReason: dialogue.fallbackReason,
      sceneCount: sceneTimes.length,
      silenceCount: silences.length,
      candidates: candidates.slice(0, 3),
    };
  }

  return { analyzeVideo, rankMemes };
}

module.exports = {
  buildSignalCandidates,
  createLocalAi,
  applyDialogueContext,
  directionKeywords,
  loadDialogueCues,
  parseSceneTimes,
  parseSilences,
  parseSubtitleCues,
  requestOllamaVision,
  requestOllamaTimelineReview,
  requestLmStudioVision,
  requestLmStudioTimelineReview,
  requestLmStudioMemeRanking,
  requestLocalVision,
  requestLocalTimelineReview,
  createFrameContactSheet,
  extractDirectionRules,
  buildTimelineWindows,
  buildDirectionAuditWindows,
  hasOpeningRemovalRule,
  normalizeVisionScore,
  enforceVisibleDirectionDecision,
  hasPositiveVisibleMatch,
  mergeExcludedTimelineRanges,
  applyMemeBeats,
  ensureLmStudioServer,
};
