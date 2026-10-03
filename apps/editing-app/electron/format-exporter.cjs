"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");

const EXPORT_FORMATS = Object.freeze({
  mp4: Object.freeze({
    extension: "mp4",
    label: "MP4 · H.264/AAC",
    args: ["-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-movflags", "+faststart"],
  }),
  "mov-prores": Object.freeze({
    extension: "mov",
    label: "MOV · ProRes 422 HQ/PCM",
    args: ["-map", "0:v:0", "-map", "0:a?", "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-c:a", "pcm_s16le"],
  }),
  webm: Object.freeze({
    extension: "webm",
    label: "WebM · VP9/Opus",
    args: ["-map", "0:v:0", "-map", "0:a?", "-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-c:a", "libopus", "-b:a", "160k"],
  }),
});

function safeProjectName(value) {
  return String(value || "Grayfox approved")
    .trim()
    .slice(0, 80)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "") || "Grayfox approved";
}

function exportFormat(format) {
  const key = String(format || "mp4").toLowerCase();
  const spec = EXPORT_FORMATS[key];
  if (!spec) throw new Error("Choose MP4, MOV ProRes, or WebM before saving.");
  return { key, ...spec };
}

function createFormatExporter({ resolveMediaTool, probeDuration, cleanText }) {
  return async function exportApprovedVideo(event, payload) {
    const sourcePath = cleanText(payload?.outputPath, "", 2000);
    const exportPath = cleanText(payload?.exportPath, "", 2000);
    if (!path.isAbsolute(sourcePath) || !path.isAbsolute(exportPath)) {
      throw new Error("An approved rendered video and export folder are required.");
    }
    await fs.access(sourcePath);
    await fs.mkdir(exportPath, { recursive: true });
    const format = exportFormat(payload?.format);
    const ffmpegPath = await resolveMediaTool("ffmpeg");
    const ffprobePath = await resolveMediaTool("ffprobe");
    const duration = await probeDuration(sourcePath, ffprobePath);
    const outputPath = path.join(
      exportPath,
      `${safeProjectName(payload?.projectName)}-approved-${Date.now()}.${format.extension}`
    );
    const args = ["-y", "-i", sourcePath, ...format.args, "-progress", "pipe:1", "-nostats", outputPath];

    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, args, { windowsHide: true });
      let stderr = "";
      let stdoutBuffer = "";
      child.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || "";
        for (const line of lines) {
          const [key, value] = line.split("=");
          if (key !== "out_time_ms" && key !== "out_time_us") continue;
          const seconds = Number(value) / 1000000;
          const percent = Math.max(0, Math.min(99, Math.round((seconds / duration) * 100)));
          event?.sender?.send?.("video:production-progress", { percent, outputPath, phase: "format-export" });
        }
      });
      child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
      child.on("error", (error) => reject(new Error(`FFmpeg unavailable: ${error.message}`)));
      child.on("close", (code) => code === 0
        ? resolve()
        : reject(new Error(stderr || `FFmpeg exited with code ${code}.`)));
    });

    const exportedDuration = await probeDuration(outputPath, ffprobePath);
    const tolerance = Math.max(0.2, duration * 0.002);
    if (Math.abs(exportedDuration - duration) > tolerance) {
      await fs.rm(outputPath, { force: true }).catch(() => {});
      throw new Error("The saved format did not preserve the approved cut duration.");
    }
    event?.sender?.send?.("video:production-progress", { percent: 100, outputPath, phase: "format-export" });
    return {
      outputPath,
      duration: exportedDuration,
      format: format.key,
      label: format.label,
    };
  };
}

module.exports = { EXPORT_FORMATS, createFormatExporter, exportFormat, safeProjectName };
