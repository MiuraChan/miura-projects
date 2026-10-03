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
  return rawSegments.slice(0, 64).map((segment) => {
    const start = Math.min(Math.max(0, Number(segment?.start) || 0), fullDuration - 0.05);
    const end = Math.min(Math.max(Number(segment?.end) || 0, start + 0.05), fullDuration);
    const effect = ["meme-punch", "meme-monochrome", "meme-flash"].includes(segment?.effect) ? segment.effect : null;
    const memeEnabled = effect ? segment?.memeEnabled !== false : false;
    const memeStart = Math.min(Math.max(Number(segment?.memeStart) || start, start), end);
    const memeEnd = Math.min(Math.max(Number(segment?.memeEnd) || memeStart + 1.2, memeStart + 0.1), end);
    const memeId = String(segment?.memeId || "").trim().slice(0, 80);
    const memeLabel = String(segment?.memeLabel || "").trim().slice(0, 100);
    const memeReason = String(segment?.memeReason || "").trim().slice(0, 300);
    const memeMetadata = {
      ...(memeId ? { memeId } : {}),
      ...(memeLabel ? { memeLabel } : {}),
      ...(memeReason ? { memeReason } : {}),
    };
    return { start, end, role: String(segment?.role || "body").slice(0, 30), ...(effect ? { effect, memeEnabled, memeStart, memeEnd, ...memeMetadata } : {}) };
  }).filter((segment) => segment.end - segment.start >= 0.05);
}

function videoFilterForSegment(segment) {
  const base = "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1";
  if (!segment.effect || segment.memeEnabled === false) return base;
  const localStart = Math.max(0, Number(segment.memeStart) - Number(segment.start));
  const localEnd = Math.max(localStart + 0.1, Number(segment.memeEnd) - Number(segment.start));
  const enabled = `between(t,${localStart.toFixed(3)},${localEnd.toFixed(3)})`;
  if (segment.effect === "meme-monochrome") return `${base},hue=s=0:enable='${enabled}'`;
  if (segment.effect === "meme-flash") return `${base},eq=brightness=0.16:saturation=1.15:enable='${enabled}'`;
  return `${base},split[base][zoom];[zoom]scale=trunc(iw*1.08/2)*2:trunc(ih*1.08/2)*2,crop=trunc(iw/1.08/2)*2:trunc(ih/1.08/2)*2:(iw-ow)/2:(ih-oh)/2[zoomed];[base][zoomed]overlay=0:0:enable='${enabled}'`;
}
function formatTimestamp(rawSeconds) {
  const seconds = Math.max(0, Math.floor(Number(rawSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function summarizeFfmpegFailure(stderr, segment, index) {
  const range = `${formatTimestamp(segment.start)}–${formatTimestamp(segment.end)}`;
  const prefix = `Segment ${index + 1} (${range})`;
  if (/partial file|invalid nal|corrupt|invalid data|no frame|error during demuxing|error retrieving a packet|nothing was written|no usable frames/i.test(stderr)) {
    return `${prefix} could not be decoded because that part of the source video is incomplete or damaged.`;
  }
  if (/malloc|cannot allocate memory|out of memory/i.test(stderr)) {
    return `${prefix} exceeded the available video memory while decoding.`;
  }
  return `${prefix} could not be decoded; that part of the source may be incomplete or damaged.`;
}

function runFfmpeg(event, ffmpegPath, args, {
  outputPath,
  phase,
  completedDuration = 0,
  currentDuration = 1,
  totalDuration = 1,
  maximumPercent = 99,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    let stdoutBuffer = "";
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 0 || line.slice(0, separator) !== "out_time_ms") continue;
        const seconds = Math.min(currentDuration, Math.max(0, Number(line.slice(separator + 1)) / 1000000));
        const percent = Math.max(0, Math.min(maximumPercent, Math.round(((completedDuration + seconds) / totalDuration) * 100)));
        event.sender.send("video:production-progress", { percent, outputPath, phase });
      }
    });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16000); });
    child.on("error", (error) => reject(Object.assign(new Error(`FFmpeg unavailable: ${error.message}`), { stderr })));
    child.on("close", (code) => {
      if (code === 0) resolve({ stderr });
      else reject(Object.assign(new Error(`FFmpeg exited with code ${code}.`), { stderr, exitCode: code }));
    });
  });
}

function concatFileEntry(filePath) {
  return `file '${filePath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
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
    if (!segments.length) throw new Error("A real edit needs at least one valid timeline segment.");

    const requestedDuration = segments.reduce((total, segment) => total + (segment.end - segment.start), 0);
    const legacyExpectedDuration = Math.max(0, Number(payload?.expectedDuration) || 0);
    const minimumDuration = Math.min(fullDuration, Math.max(0, Number(payload?.minimumDuration) || legacyExpectedDuration));
    const maximumDuration = Math.min(fullDuration, Math.max(minimumDuration, Number(payload?.maximumDuration) || legacyExpectedDuration));
    const minimumTolerance = Math.max(2, minimumDuration * 0.03);
    const maximumTolerance = Math.max(2, maximumDuration * 0.03);
    if (minimumDuration && requestedDuration < minimumDuration - minimumTolerance) {
      throw new Error(`The edit plan covers only ${formatTimestamp(requestedDuration)} but the minimum is ${formatTimestamp(minimumDuration)}. Grayfox stopped instead of producing a misleading short file.`);
    }
    if (maximumDuration && requestedDuration > maximumDuration + maximumTolerance) {
      throw new Error(`The edit plan covers ${formatTimestamp(requestedDuration)} but the maximum is ${formatTimestamp(maximumDuration)}. Grayfox stopped before exceeding your limit.`);
    }
    const { stdout: audioStream } = await execFileAsync(ffprobePath, [
      "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", sourcePath,
    ], { windowsHide: true });
    const hasAudio = Boolean(audioStream.trim());
    const outputPath = path.join(exportPath, `${safeProjectName(payload?.projectName)}-${Date.now()}.mp4`);
    const tempRoot = await fs.mkdtemp(path.join(exportPath, ".grayfox-render-"));
    const rendered = [];
    const skippedSegments = [];
    let processedDuration = 0;
    let renderedDuration = 0;

    try {
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const segmentDuration = segment.end - segment.start;
        const segmentPath = path.join(tempRoot, `segment-${String(index + 1).padStart(3, "0")}.mp4`);
        const args = [
          "-y",
          "-fflags", "+discardcorrupt",
          "-err_detect", "ignore_err",
          "-ss", String(segment.start),
          "-i", sourcePath,
          "-t", String(segmentDuration),
          "-map", "0:v:0",
          ...(hasAudio ? ["-map", "0:a:0?"] : []),
          "-sn", "-dn",
          "-vf", videoFilterForSegment(segment),
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
          ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
          "-movflags", "+faststart",
          "-progress", "pipe:1", "-nostats",
          segmentPath,
        ];
        try {
          const processResult = await runFfmpeg(event, ffmpegPath, args, {
            outputPath,
            phase: "segment-render",
            completedDuration: processedDuration,
            currentDuration: segmentDuration,
            totalDuration: requestedDuration,
            maximumPercent: 94,
          });
          const measuredDuration = await probeDuration(segmentPath, ffprobePath);
          const stat = await fs.stat(segmentPath);
          if (!Number.isFinite(measuredDuration) || measuredDuration < 0.05 || stat.size < 1024) {
            throw Object.assign(new Error("Rendered segment contains no usable frames."), { stderr: processResult.stderr });
          }
          rendered.push({ ...segment, path: segmentPath, duration: measuredDuration, requestedIndex: index });
          renderedDuration += segmentDuration;
        } catch (error) {
          await fs.rm(segmentPath, { force: true }).catch(() => {});
          skippedSegments.push({
            ...segment,
            requestedIndex: index,
            reason: summarizeFfmpegFailure(`${error?.stderr || ""}\n${error?.message || ""}`, segment, index),
          });
        }
        processedDuration += segmentDuration;
      }

      if (!rendered.length) {
        throw new Error("Grayfox could not decode any selected sections. The source video appears incomplete or damaged. Re-export or re-download it, then try again.");
      }

      if (rendered.length === 1) {
        await fs.copyFile(rendered[0].path, outputPath);
      } else {
        const concatPath = path.join(tempRoot, "segments.txt");
        await fs.writeFile(concatPath, `${rendered.map((segment) => concatFileEntry(segment.path)).join("\n")}\n`, "utf8");
        await runFfmpeg(event, ffmpegPath, [
          "-y", "-f", "concat", "-safe", "0", "-i", concatPath,
          "-c", "copy", "-movflags", "+faststart",
          "-progress", "pipe:1", "-nostats", outputPath,
        ], {
          outputPath,
          phase: "segment-concat",
          completedDuration: 0,
          currentDuration: renderedDuration,
          totalDuration: renderedDuration,
          maximumPercent: 99,
        });
      }

      const duration = await probeDuration(outputPath, ffprobePath);
      const outputStat = await fs.stat(outputPath);
      if (!Number.isFinite(duration) || duration < 0.05 || outputStat.size < 1024) {
        throw new Error("Grayfox rendered an empty file. The selected source sections may be damaged.");
      }
      const meetsTarget = (!minimumDuration || duration >= minimumDuration - minimumTolerance)
        && (!maximumDuration || duration <= maximumDuration + maximumTolerance);
      const durationWarning = meetsTarget
        ? null
        : (duration < minimumDuration
          ? `Rendered ${formatTimestamp(duration)}, below the ${formatTimestamp(minimumDuration)} minimum, because ${skippedSegments.length} source section${skippedSegments.length === 1 ? " was" : "s were"} unreadable.`
          : `Rendered ${formatTimestamp(duration)}, above the ${formatTimestamp(maximumDuration)} maximum.`);
      event.sender.send("video:production-progress", { percent: 100, outputPath, phase: "multi-segment-edit" });
      return {
        outputPath,
        duration,
        segmentCount: rendered.length,
        requestedSegmentCount: segments.length,
        targetDuration: maximumDuration || minimumDuration || requestedDuration,
        minimumDuration,
        maximumDuration,
        meetsTarget,
        durationWarning,
        segments: rendered.map(({ path: _path, duration: _duration, requestedIndex: _requestedIndex, ...segment }) => segment),
        skippedSegments,
        sourceDuration: fullDuration,
        removedDuration: Math.max(0, fullDuration - duration),
      };
    } catch (error) {
      await fs.rm(outputPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { produceEditedVideo };
}

module.exports = {
  cleanSegments,
  videoFilterForSegment,
  concatFileEntry,
  createEditRenderer,
  formatTimestamp,
  safeProjectName,
  summarizeFfmpegFailure,
};
