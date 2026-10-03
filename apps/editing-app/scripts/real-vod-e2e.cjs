process.env.GRAYFOX_LIBRARY_MODE = "1";

const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app } = require("electron");
const { analyzeVideo, exportApprovedVideo, probeDuration, produceEditedVideo, resolveMediaTool } = require("../electron/main.cjs");
const { createHandoff } = require("../electron/handoff.cjs");

const execFileAsync = promisify(execFile);
const originalSource = process.env.GRAYFOX_REAL_VIDEO || "D:\\VODS\\2024-02-22 21-00-36.mkv";
const artifactRoot = path.join(__dirname, "..", "test-artifacts", "2026-08-10", "real-e2e");
const samplePath = path.join(artifactRoot, "starting-soon-to-camera-8m.mkv");

function overlapSeconds(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

async function ensureSample(ffmpegPath) {
  try {
    const duration = await probeDuration(samplePath);
    if (duration >= 475 && duration <= 485) return duration;
  } catch { /* Create the sample from the immutable source. */ }
  await fs.access(originalSource);
  await fs.mkdir(artifactRoot, { recursive: true });
  await execFileAsync(ffmpegPath, [
    "-y", "-ss", "0", "-i", originalSource, "-t", "480", "-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-avoid_negative_ts", "make_zero", samplePath,
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return probeDuration(samplePath);
}

async function codecReport(ffprobePath, filePath) {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", filePath,
  ], { windowsHide: true });
  return JSON.parse(stdout);
}

async function main() {
  await app.whenReady();
  const ffmpegPath = await resolveMediaTool("ffmpeg");
  const ffprobePath = await resolveMediaTool("ffprobe");
  const sampleDuration = await ensureSample(ffmpegPath);
  const runRoot = path.join(artifactRoot, `run-${Date.now()}`);
  await fs.mkdir(runRoot, { recursive: true });
  const progress = [];
  const event = { sender: { send: (_channel, value) => progress.push(value) } };
  const direction = "Rimuovi la prima parte con la schermata Starting Soon. Mantieni e dai priorità alla parte in cui parlo direttamente alla camera.";

  const analysis = await analyzeVideo(event, {
    mode: "edit",
    sourcePath: samplePath,
    targetLength: 120,
    segmentLength: 10,
    finalUse: "YouTube long-form story",
    tone: "direct, energetic, concise",
    direction,
  });
  if (analysis.provider !== "lm-studio-qwen3-vl") throw new Error(`Vision fallback was used: ${analysis.provider} ${analysis.fallbackReason || ""}`);
  if (analysis.directionAuditCoverage < 0.95) throw new Error(`Direction audit coverage was only ${analysis.directionAuditCoverage}.`);
  if (!analysis.excludedRanges.length) throw new Error("The Starting Soon opening was not excluded.");
  const excludedSeconds = analysis.excludedRanges.reduce((sum, range) => sum + range.end - range.start, 0);
  if (excludedSeconds < 60) throw new Error(`Only ${excludedSeconds}s of the visible opening were excluded.`);
  if (!analysis.editPlan?.segments?.length) throw new Error("No multi-segment edit plan was created.");
  for (const segment of analysis.editPlan.segments) {
    if (analysis.excludedRanges.some((range) => overlapSeconds(segment, range) > 0.01)) {
      throw new Error(`Selected segment ${segment.start}-${segment.end} overlaps a mandatory exclusion.`);
    }
    if (segment.start < 300) throw new Error(`The known Starting Soon opening leaked into the output at ${segment.start}s.`);
  }

  const firstCut = await produceEditedVideo(event, {
    sourcePath: samplePath,
    exportPath: runRoot,
    projectName: "Grayfox real VOD first cut",
    segments: analysis.editPlan.segments,
    expectedDuration: 120,
  });
  if (!firstCut.meetsTarget) throw new Error(firstCut.durationWarning || "The first cut missed its requested duration.");

  const revisedSegments = analysis.editPlan.segments.map((segment) => ({ ...segment }));
  const manualSegment = revisedSegments.find((segment) => segment.end - segment.start >= 1.5);
  if (!manualSegment) throw new Error("No segment could receive the manual meme test.");
  manualSegment.effect = "meme-flash";
  manualSegment.memeEnabled = true;
  manualSegment.memeSuggested = false;
  manualSegment.memeStart = manualSegment.start + 0.4;
  manualSegment.memeEnd = Math.min(manualSegment.end, manualSegment.memeStart + 1.1);
  manualSegment.memeReason = "Manual end-to-end meme test";

  const memeRevision = await produceEditedVideo(event, {
    sourcePath: samplePath,
    exportPath: runRoot,
    projectName: "Grayfox real VOD meme revision",
    segments: revisedSegments,
    expectedDuration: 120,
  });
  if (!memeRevision.meetsTarget) throw new Error("The meme revision changed the approved duration.");

  const savedMp4 = await exportApprovedVideo(event, {
    outputPath: memeRevision.outputPath,
    exportPath: runRoot,
    projectName: "Grayfox real VOD",
    format: "mp4",
  });
  const handoff = createHandoff({ shell: { showItemInFolder() {}, async openExternal() {} } });
  const sharedHandoff = {
    sourcePath: samplePath,
    outputPath: memeRevision.outputPath,
    exportPath: runRoot,
    projectName: "Grayfox real VOD",
    duration: memeRevision.duration,
    approvedAt: new Date().toISOString(),
    direction,
    tone: ["direct", "energetic", "concise"],
    segments: revisedSegments,
  };
  const handoffs = {};
  for (const target of ["premiere", "after-effects", "youtube", "tiktok", "instagram"]) {
    handoffs[target] = await handoff(null, { ...sharedHandoff, target });
  }

  const report = {
    originalSource,
    samplePath,
    sampleDuration,
    direction,
    provider: analysis.provider,
    model: analysis.model,
    directionAudit: { reviewed: analysis.directionAuditCount, expected: analysis.directionAuditExpected, coverage: analysis.directionAuditCoverage },
    excludedRanges: analysis.excludedRanges,
    excludedSeconds,
    aiMemeBeatCount: analysis.memeBeatCount,
    editPlan: analysis.editPlan,
    firstCut: { ...firstCut, media: await codecReport(ffprobePath, firstCut.outputPath) },
    memeRevision: { ...memeRevision, media: await codecReport(ffprobePath, memeRevision.outputPath) },
    savedMp4,
    handoffs,
    progressPhases: [...new Set(progress.map((item) => item.phase).filter(Boolean))],
  };
  const reportPath = path.join(runRoot, "e2e-report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`GRAYFOX_REAL_E2E_OK ${JSON.stringify({ reportPath, provider: report.provider, audit: report.directionAudit, excludedSeconds, segments: analysis.editPlan.segments.length, aiMemeBeatCount: analysis.memeBeatCount, firstCut: firstCut.outputPath, memeRevision: memeRevision.outputPath, savedMp4: savedMp4.outputPath, handoffTargets: Object.keys(handoffs) })}\n`);
  app.quit();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
