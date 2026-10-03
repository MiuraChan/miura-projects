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
      minimumDuration: 4,
      maximumDuration: 8,
    });

    const measured = await probeDuration(result.outputPath, ffprobePath);
    const stat = await fs.stat(result.outputPath);
    if (result.segmentCount !== 3 || !result.meetsTarget || result.minimumDuration !== 4 || result.maximumDuration !== 8 || stat.size <= 0 || Math.abs(measured - 6) > 0.2 || !progress.includes(100)) {
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

    let minimumGuard = "";
    try {
      await produceEditedVideo({ sender: { send() {} } }, {
        sourcePath,
        exportPath,
        projectName: "below-minimum",
        segments: [{ start: 0, end: 2, role: "hook" }],
        minimumDuration: 6,
        maximumDuration: 8,
      });
    } catch (error) {
      minimumGuard = error.message;
    }
    if (!/minimum is 0:06/i.test(minimumGuard)) {
      throw new Error(`Minimum duration guard failed: ${minimumGuard || "render unexpectedly started"}`);
    }

    let maximumGuard = "";
    try {
      await produceEditedVideo({ sender: { send() {} } }, {
        sourcePath,
        exportPath,
        projectName: "above-maximum",
        segments: [{ start: 0, end: 11, role: "hook" }],
        minimumDuration: 2,
        maximumDuration: 6,
      });
    } catch (error) {
      maximumGuard = error.message;
    }
    if (!/maximum is 0:06/i.test(maximumGuard)) {
      throw new Error(`Maximum duration guard failed: ${maximumGuard || "render unexpectedly started"}`);
    }

    const single = await produceEditedVideo({ sender: { send() {} } }, {
      sourcePath,
      exportPath,
      projectName: "verified-single-meme",
      segments: [{ start: 2, end: 4, role: "hook", effect: "meme-flash", memeEnabled: true, memeStart: 2.4, memeEnd: 3.3 }],
      expectedDuration: 2,
    });
    const singleDuration = await probeDuration(single.outputPath, ffprobePath);
    if (single.segmentCount !== 1 || Math.abs(singleDuration - 2) > 0.2) {
      throw new Error(`Invalid one-segment meme edit: ${JSON.stringify({ single, singleDuration })}`);
    }
    const frameLuma = async (filePath, seconds) => {
      const { stdout, stderr } = await execFileAsync(ffmpegPath, [
        "-hide_banner", "-ss", String(seconds), "-i", filePath,
        "-frames:v", "1", "-vf", "signalstats,metadata=mode=print:file=-", "-f", "null", "-",
      ], { windowsHide: true });
      const match = `${stdout}\n${stderr}`.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/);
      return match ? Number(match[1]) : NaN;
    };
    const sourceLuma = await frameLuma(sourcePath, 2.7);
    const editedLuma = await frameLuma(single.outputPath, 0.7);
    const singleMemeLumaDelta = editedLuma - sourceLuma;
    if (!Number.isFinite(singleMemeLumaDelta) || singleMemeLumaDelta < 8) {
      throw new Error(`The one-segment visual edit was not visible in the rendered pixels: ${JSON.stringify({ sourceLuma, editedLuma, singleMemeLumaDelta })}`);
    }

    process.stdout.write(`GRAYFOX_EDIT_OK ${JSON.stringify({
      sourceDuration: result.sourceDuration,
      outputDuration: measured,
      removedDuration: result.removedDuration,
      segments: result.segmentCount,
      size: stat.size,
      codecs: [video.codec_name, audio.codec_name],
      durationWindow: [result.minimumDuration, result.maximumDuration],
      rangeGuards: ["minimum", "maximum"],
      singleMemeDuration: Number(singleDuration.toFixed(3)),
      singleMemeLumaDelta: Number(singleMemeLumaDelta.toFixed(3)),
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
