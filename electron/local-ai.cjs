"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
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

function buildSignalCandidates({
  duration,
  targetLength,
  sceneTimes = [],
  silences = [],
  tone = "",
  finalUse = "",
  direction = "",
  limit = 8,
}) {
  const length = clamp(Number(targetLength) || 30, 3, duration);
  const latestStart = Math.max(0, duration - length);
  const regular = duration <= length
    ? [0]
    : Array.from({ length: 8 }, (_value, index) => latestStart * (index / 7));
  const sceneStarts = sceneTimes.map((time) => clamp(time - Math.min(2, length * 0.08), 0, latestStart));
  const starts = [...new Set([...regular, ...sceneStarts].map((value) => Number(value.toFixed(1))))]
    .sort((a, b) => a - b)
    .filter((value, index, values) => index === 0 || value - values[index - 1] >= Math.min(2, length * 0.12));
  const brief = `${tone} ${finalUse} ${direction}`.toLowerCase();
  const energetic = /(energetic|dynamic|bold|fast|punchy|exciting|event|highlight|action|meme|funny)/.test(brief);
  const calm = /(warm|premium|calm|cinematic|elegant|thoughtful|emotional)/.test(brief);
  const direct = /(direct|concise|short|clear|helpful|tutorial|result|reveal|hook)/.test(brief);

  return starts.map((start) => {
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
  }).sort((a, b) => b.score - a.score).slice(0, limit);
}

async function extractCandidateFrames(sourcePath, candidates, ffmpegPath, temporaryDirectory) {
  await fs.mkdir(temporaryDirectory, { recursive: true });
  const images = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const timestamp = candidate.start + Math.min(3, Math.max(0.2, (candidate.end - candidate.start) / 2));
    const framePath = path.join(temporaryDirectory, `candidate-${index}.jpg`);
    await execFileAsync(ffmpegPath, [
      "-y", "-ss", String(timestamp), "-i", sourcePath,
      "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", framePath,
    ], { windowsHide: true });
    images.push((await fs.readFile(framePath)).toString("base64"));
  }
  return images;
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
Image order matches candidate indexes ${candidates.map((_candidate, index) => index).join(", ")}.
Return JSON only: {"rankings":[{"index":0,"semanticScore":0,"memeScore":0,"title":"short factual title","rationale":"one grounded sentence","memeReason":"one sentence about reaction face, irony, punchline, or text-overlay potential"}]}.
Use scores from 0 to 100. Do not invent dialogue or audio. Evaluate visible subject, action, emotion, clarity, hook, brand safety, and meme potential.`,
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

function createLocalAi({ resolveMediaTool, probeDuration, cleanText }) {
  async function analyzeVideo(_event, payload) {
    const sourcePath = cleanText(payload?.sourcePath, "", 2000);
    if (!path.isAbsolute(sourcePath)) throw new Error("Choose a local source video before analysis.");
    await fs.access(sourcePath);
    const ffmpegPath = await resolveMediaTool("ffmpeg");
    const ffprobePath = await resolveMediaTool("ffprobe");
    const duration = await probeDuration(sourcePath, ffprobePath);
    const targetLength = clamp(Number(payload?.targetLength) || 30, 3, duration);
    const mode = payload?.mode === "edit" ? "edit" : "clips";
    const candidateLength = mode === "edit"
      ? clamp(Number(payload?.segmentLength) || Math.min(12, targetLength / 3), 4, Math.min(20, duration))
      : targetLength;
    const [sceneResult, silenceResult] = await Promise.all([
      collectProcessOutput(ffmpegPath, [
        "-hide_banner", "-i", sourcePath,
        "-vf", "select=gt(scene\\,0.22),showinfo", "-an", "-f", "null", "-",
      ]),
      collectProcessOutput(ffmpegPath, [
        "-hide_banner", "-i", sourcePath,
        "-af", "silencedetect=noise=-35dB:d=0.35", "-vn", "-f", "null", "-",
      ]),
    ]);
    const sceneTimes = parseSceneTimes(sceneResult.stderr);
    const silences = parseSilences(silenceResult.stderr, duration);
    const candidates = buildSignalCandidates({
      duration,
      targetLength: candidateLength,
      sceneTimes,
      silences,
      tone: cleanText(payload?.tone, "", 500),
      finalUse: cleanText(payload?.finalUse, "", 100),
      direction: cleanText(payload?.direction, "", 5000),
    });
    const temporaryDirectory = path.join(app.getPath("temp"), `grayfox-analysis-${process.pid}-${Date.now()}`);
    let provider = "local-signals";
    let model = null;
    let fallbackReason = null;
    try {
      const images = await extractCandidateFrames(sourcePath, candidates, ffmpegPath, temporaryDirectory);
      const vision = await requestOllamaVision(
        candidates,
        images,
        `${payload?.finalUse || ""}; ${payload?.tone || ""}; ${payload?.direction || ""}`
      );
      provider = "ollama-vision";
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
      model = null;
      fallbackReason = cleanText(error?.message, "Local vision model unavailable.", 500);
      if (candidates[0]) {
        candidates[0].note = `${candidates[0].note}. Vision model unavailable; ranked from measured scene and audio signals.`;
      }
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
    const editPlan = mode === "edit" ? buildEditPlan({
      candidates,
      silences,
      sourceDuration: duration,
      desiredDuration: targetLength,
      direction: cleanText(payload?.direction, "", 5000),
      tone: cleanText(payload?.tone, "", 500),
    }) : null;
    return {
      duration,
      targetLength,
      provider,
      model,
      editPlan,
      fallbackReason,
      sceneCount: sceneTimes.length,
      silenceCount: silences.length,
      candidates: candidates.slice(0, 3),
    };
  }

  return { analyzeVideo };
}

module.exports = {
  buildSignalCandidates,
  createLocalAi,
  parseSceneTimes,
  parseSilences,
  requestOllamaVision,
};
