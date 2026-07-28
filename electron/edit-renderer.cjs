"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function safeProjectName(value) {
  return String(value || "Grayfox edit")
    .trim()
    .slice(0, 80)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "") || "Grayfox edit";
}

function cleanSegments(rawSegments, fullDuration) {
  if (!Array.isArray(rawSegments)) return [];
  return rawSegments.slice(0, 12).map((segment) => {
    const start = Math.min(Math.max(0, Number(segment?.start) || 0), fullDuration - 0.05);
    const end = Math.min(Math.max(Number(segment?.end) || 0, start + 0.05), fullDuration);
    return { start, end, role: String(segment?.role || "body").slice(0, 30) };
  }).filter((segment) => segment.end - segment.start >= 0.05);
}

function runFfmpegEdit(event, ffmpegPath, args, outputPath, renderDuration) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    let stdoutBuffer = "";
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const [key, value] = line.split("=");
        if (key !== "out_time_ms") continue;
        const seconds = Number(value) / 1000000;
        const percent = Math.max(0, Math.min(99, Math.round((seconds / renderDuration) * 100)));
        event.sender.send("video:production-progress", { percent, outputPath, phase: "multi-segment-edit" });
      }
    });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
    child.on("error", (error) => reject(new Error(`FFmpeg unavailable: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited with code ${code}.`)));
  });
}

function createEditRenderer({ resolveMediaTool, probeDuration, cleanText }) {
  async function produceEditedVideo(event, payload) {
    const sourcePath = cleanText(payload?.sourcePath, "", 2000);
    const exportPath = cleanText(payload?.exportPath, "", 2000);
    if (!path.isAbsolute(sourcePath) || !path.isAbsolute(exportPath)) {
      throw new Error("Invalid source or export path.");
    }
    await fs.access(sourcePath);
    await fs.mkdir(exportPath, { recursive: true });
    const ffprobePath = await resolveMediaTool("ffprobe");
    const ffmpegPath = await resolveMediaTool("ffmpeg");
    const fullDuration = await probeDuration(sourcePath, ffprobePath);
    const segments = cleanSegments(payload?.segments, fullDuration);
    if (segments.length < 2) throw new Error("A real edit needs at least two valid timeline segments.");
    const renderDuration = segments.reduce((total, segment) => total + (segment.end - segment.start), 0);
    const { stdout: audioStream } = await execFileAsync(ffprobePath, [
      "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", sourcePath,
    ], { windowsHide: true });
    const hasAudio = Boolean(audioStream.trim());
    const chains = [];
    const concatInputs = [];
    segments.forEach((segment, index) => {
      chains.push(`[0:v]trim=start=${segment.start}:end=${segment.end},setpts=PTS-STARTPTS[v${index}]`);
      concatInputs.push(`[v${index}]`);
      if (hasAudio) {
        chains.push(`[0:a]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS[a${index}]`);
        concatInputs.push(`[a${index}]`);
      }
    });
    chains.push(`${concatInputs.join("")}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}[vout]${hasAudio ? "[aout]" : ""}`);
    const outputPath = path.join(exportPath, `${safeProjectName(payload?.projectName)}-${Date.now()}.mp4`);
    const args = [
      "-y", "-i", sourcePath,
      "-filter_complex", chains.join(";"),
      "-map", "[vout]",
      ...(hasAudio ? ["-map", "[aout]"] : []),
      "-c:v", "libx264", "-preset", "medium", "-crf", "20",
      ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
      "-movflags", "+faststart",
      "-progress", "pipe:1", "-nostats",
      outputPath,
    ];
    await runFfmpegEdit(event, ffmpegPath, args, outputPath, renderDuration);
    event.sender.send("video:production-progress", { percent: 100, outputPath, phase: "multi-segment-edit" });
    return {
      outputPath,
      duration: renderDuration,
      segmentCount: segments.length,
      segments,
      sourceDuration: fullDuration,
      removedDuration: Math.max(0, fullDuration - renderDuration),
    };
  }

  return { produceEditedVideo };
}

module.exports = {
  cleanSegments,
  createEditRenderer,
  safeProjectName,
};
