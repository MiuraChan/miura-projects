const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app } = require("electron");
process.env.GRAYFOX_LIBRARY_MODE = "1";
const { produceVideo, probeDuration, resolveMediaTool } = require("../electron/main.cjs");

const execFileAsync = promisify(execFile);

app.whenReady().then(async () => {
  const testRoot = path.join(app.getPath("temp"), `grayfox-ffmpeg-integration-${process.pid}-${Date.now()}`);
  const sourcePath = path.join(testRoot, "source.mp4");
  const exportPath = path.join(testRoot, "exports");
  try {
    await fs.mkdir(exportPath, { recursive: true });
    const ffmpegPath = await resolveMediaTool("ffmpeg");
    const ffprobePath = await resolveMediaTool("ffprobe");
    await execFileAsync(ffmpegPath, [
      "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
      "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath,
    ], { windowsHide: true });

    const cases = [
      { name: "middle-cut", start: 1, end: 2.5, expected: 1.5 },
      { name: "opening-cut", start: 0, end: 1, expected: 1 },
      { name: "to-source-end", start: 2, end: 0, expected: 2 },
    ];
    const results = [];
    for (const testCase of cases) {
      const progress = [];
      const result = await produceVideo({ sender: { send: (_channel, value) => progress.push(value.percent) } }, {
        sourcePath,
        exportPath,
        projectName: testCase.name,
        trimStart: testCase.start,
        trimEnd: testCase.end,
      });
      const measured = await probeDuration(result.outputPath, ffprobePath);
      const stat = await fs.stat(result.outputPath);
      const tolerance = 0.16;
      if (stat.size <= 0 || Math.abs(measured - testCase.expected) > tolerance || !progress.includes(100)) {
        throw new Error(`Invalid ${testCase.name}: expected=${testCase.expected}, duration=${measured}, size=${stat.size}, progress=${progress.join(",")}`);
      }
      results.push({ name: testCase.name, outputPath: result.outputPath, duration: measured, size: stat.size });
    }

    const { stdout: streamJson } = await execFileAsync(ffprobePath, [
      "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", results[0].outputPath,
    ], { windowsHide: true });
    const streams = JSON.parse(streamJson).streams || [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    if (video?.codec_name !== "h264" || audio?.codec_name !== "aac") {
      throw new Error(`Unexpected codecs: ${JSON.stringify(streams)}`);
    }
    const files = (await fs.readdir(exportPath)).filter((name) => name.endsWith(".mp4"));
    if (files.length !== cases.length) throw new Error(`Expected ${cases.length} MP4 files, found ${files.length}.`);

    process.stdout.write(`GRAYFOX_FFMPEG_OK ${JSON.stringify({ cuts: results.map(({ name, duration, size }) => ({ name, duration, size })), codecs: [video.codec_name, audio.codec_name] })}\n`);
  } finally {
    const tempRoot = path.resolve(app.getPath("temp"));
    const resolvedTestRoot = path.resolve(testRoot);
    if (resolvedTestRoot.startsWith(`${tempRoot}${path.sep}`) && path.basename(resolvedTestRoot).startsWith("grayfox-ffmpeg-integration-")) {
      await fs.rm(resolvedTestRoot, { recursive: true, force: true });
    }
  }
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});