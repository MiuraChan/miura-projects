process.env.GRAYFOX_LIBRARY_MODE = "1";

const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app } = require("electron");
const { exportApprovedVideo, probeDuration, resolveMediaTool } = require("../electron/main.cjs");

const execFileAsync = promisify(execFile);

async function streamCodecs(ffprobePath, filePath) {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", filePath,
  ], { windowsHide: true });
  return JSON.parse(stdout).streams || [];
}

async function main() {
  await app.whenReady();
  const root = path.join(app.getPath("temp"), `grayfox-format-${process.pid}-${Date.now()}`);
  const sourcePath = path.join(root, "approved-cut.mp4");
  const exportPath = path.join(root, "exports");
  await fs.mkdir(exportPath, { recursive: true });
  try {
    const ffmpegPath = await resolveMediaTool("ffmpeg");
    const ffprobePath = await resolveMediaTool("ffprobe");
    await execFileAsync(ffmpegPath, [
      "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=2",
      "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath,
    ], { windowsHide: true });

    const expected = {
      mp4: { video: "h264", audio: "aac" },
      "mov-prores": { video: "prores", audio: "pcm_s16le" },
      webm: { video: "vp9", audio: "opus" },
    };
    const outputs = [];
    for (const format of Object.keys(expected)) {
      const progress = [];
      const result = await exportApprovedVideo({ sender: { send: (_channel, value) => progress.push(value.percent) } }, {
        outputPath: sourcePath,
        exportPath,
        projectName: `Format ${format}`,
        format,
      });
      const duration = await probeDuration(result.outputPath, ffprobePath);
      const streams = await streamCodecs(ffprobePath, result.outputPath);
      const video = streams.find((stream) => stream.codec_type === "video")?.codec_name;
      const audio = streams.find((stream) => stream.codec_type === "audio")?.codec_name;
      if (video !== expected[format].video || audio !== expected[format].audio) {
        throw new Error(`${format} codecs were ${video}/${audio}, expected ${expected[format].video}/${expected[format].audio}.`);
      }
      if (Math.abs(duration - 2) > 0.25) throw new Error(`${format} duration drifted to ${duration}.`);
      if (!progress.includes(100)) throw new Error(`${format} did not report completion.`);
      outputs.push({ format, extension: path.extname(result.outputPath), duration: Number(duration.toFixed(3)), video, audio });
    }
    process.stdout.write(`GRAYFOX_FORMATS_OK ${JSON.stringify(outputs)}\n`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    app.quit();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
