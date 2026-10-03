const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app } = require("electron");

process.env.GRAYFOX_LIBRARY_MODE = "1";
const { produceEditedVideo, probeDuration, resolveMediaTool } = require("../electron/main.cjs");

const execFileAsync = promisify(execFile);

app.whenReady().then(async () => {
  const testRoot = path.join(app.getPath("temp"), `grayfox-edit-integration-${process.pid}-${Date.now()}`);
  const sourcePath = path.join(testRoot, "source.mp4");
  const exportPath = path.join(testRoot, "exports");
  try {
    await fs.mkdir(exportPath, { recursive: true });
    const ffmpegPath = await resolveMediaTool("ffmpeg");
    const ffprobePath = await resolveMediaTool("ffprobe");
    await execFileAsync(ffmpegPath, [
      "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x180:r=25:d=3",
      "-f", "lavfi", "-i", "color=c=green:s=320x180:r=25:d=3",
      "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=25:d=3",
      "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=3",
      "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=12",
      "-filter_complex", "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]",
      "-map", "[v]", "-map", "4:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      sourcePath,
    ], { windowsHide: true });

    const progress = [];
    const result = await produceEditedVideo({
      sender: { send: (_channel, value) => progress.push(value.percent) },
    }, {
      sourcePath,
      exportPath,
      projectName: "verified-multicut",
      segments: [
        { start: 0, end: 2, role: "hook", effect: "meme-punch", memeStart: 0.4, memeEnd: 1.2 },
        { start: 4, end: 6, role: "body", effect: "meme-monochrome", memeStart: 4.3, memeEnd: 5.1 },
        { start: 9, end: 11, role: "close", effect: "meme-flash", memeStart: 9.4, memeEnd: 10.2 },
      ],
    });

    const measured = await probeDuration(result.outputPath, ffprobePath);
    const stat = await fs.stat(result.outputPath);
    if (result.segmentCount !== 3 || stat.size <= 0 || Math.abs(measured - 6) > 0.2 || !progress.includes(100)) {
      throw new Error(`Invalid multi-edit: ${JSON.stringify({ result, measured, size: stat.size, progress })}`);
    }

    const { stdout: streamJson } = await execFileAsync(ffprobePath, [
      "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", result.outputPath,
    ], { windowsHide: true });
    const streams = JSON.parse(streamJson).streams || [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    if (video?.codec_name !== "h264" || audio?.codec_name !== "aac") {
      throw new Error(`Unexpected codecs: ${JSON.stringify(streams)}`);
    }

    process.stdout.write(`GRAYFOX_EDIT_OK ${JSON.stringify({
      sourceDuration: result.sourceDuration,
      outputDuration: measured,
      removedDuration: result.removedDuration,
      segments: result.segmentCount,
      size: stat.size,
      codecs: [video.codec_name, audio.codec_name],
    })}\n`);
  } finally {
    const tempRoot = path.resolve(app.getPath("temp"));
    const resolvedTestRoot = path.resolve(testRoot);
    if (resolvedTestRoot.startsWith(`${tempRoot}${path.sep}`) && path.basename(resolvedTestRoot).startsWith("grayfox-edit-integration-")) {
      await fs.rm(resolvedTestRoot, { recursive: true, force: true });
    }
  }
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
