const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app } = require("electron");

process.env.GRAYFOX_LIBRARY_MODE = "1";
const { produceEditedVideo, probeDuration, resolveMediaTool } = require("../electron/main.cjs");
const { buildEditPlan } = require("../electron/edit-planner.cjs");

const execFileAsync = promisify(execFile);

app.whenReady().then(async () => {
  const testRoot = path.join(app.getPath("temp"), `grayfox-edit-resilience-${process.pid}-${Date.now()}`);
  const sourcePath = path.join(testRoot, "long-source.mp4");
  const damagedPath = path.join(testRoot, "damaged-source.mp4");
  const exportPath = path.join(testRoot, "exports");
  try {
    await fs.mkdir(exportPath, { recursive: true });
    const ffmpegPath = await resolveMediaTool("ffmpeg");
    const ffprobePath = await resolveMediaTool("ffprobe");
    await execFileAsync(ffmpegPath, [
      "-y",
      "-f", "lavfi", "-i", "testsrc2=s=96x54:r=2:d=2700",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32",
      "-g", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
      sourcePath,
    ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });

    const progress = [];
    const longResult = await produceEditedVideo({
      sender: { send: (_channel, value) => progress.push(value.percent) },
    }, {
      sourcePath,
      exportPath,
      projectName: "long-distance-edit",
      segments: [
        { start: 500, end: 502, role: "body" },
        { start: 720, end: 722, role: "body" },
        { start: 2226, end: 2230, role: "hook" },
      ],
    });
    const longDuration = await probeDuration(longResult.outputPath, ffprobePath);
    if (longResult.segmentCount !== 3 || longResult.skippedSegments.length !== 0 || Math.abs(longDuration - 8) > 0.35 || !progress.includes(100)) {
      throw new Error(`Long-distance edit failed: ${JSON.stringify({ longResult, longDuration, progress })}`);
    }

    const productionPlan = buildEditPlan({
      candidates: [
        { start: 100, end: 120, score: 72 },
        { start: 900, end: 920, score: 96 },
        { start: 1800, end: 1820, score: 84 },
      ],
      silences: [
        { start: 300, end: 330 },
        { start: 900, end: 930 },
        { start: 1500, end: 1530 },
        { start: 2100, end: 2130 },
      ],
      sourceDuration: 2700,
      desiredDuration: 2400,
      direction: "Produce a forty-minute edit and remove dead air",
    });
    const productionResult = await produceEditedVideo({
      sender: { send: () => {} },
    }, {
      sourcePath,
      exportPath,
      projectName: "forty-minute-production",
      expectedDuration: 2400,
      segments: productionPlan.segments,
    });
    const productionDuration = await probeDuration(productionResult.outputPath, ffprobePath);
    if (!productionResult.meetsTarget || Math.abs(productionDuration - 2400) > 2 || productionResult.segmentCount < 2) {
      throw new Error(`Forty-minute production failed: ${JSON.stringify({ productionPlan, productionResult, productionDuration })}`);
    }

    await fs.copyFile(sourcePath, damagedPath);
    const originalStat = await fs.stat(damagedPath);
    await fs.truncate(damagedPath, Math.floor(originalStat.size * 0.35));
    const damagedResult = await produceEditedVideo({
      sender: { send: () => {} },
    }, {
      sourcePath: damagedPath,
      exportPath,
      projectName: "recover-damaged-edit",
      segments: [
        { start: 1, end: 3, role: "hook" },
        { start: 2226, end: 2230, role: "close" },
      ],
    });
    const recoveredDuration = await probeDuration(damagedResult.outputPath, ffprobePath);
    if (damagedResult.segmentCount !== 1 || damagedResult.requestedSegmentCount !== 2 || damagedResult.skippedSegments.length !== 1 || Math.abs(recoveredDuration - 2) > 0.35) {
      throw new Error(`Damaged-source recovery failed: ${JSON.stringify({ damagedResult, recoveredDuration })}`);
    }
    if (!/incomplete or damaged/i.test(damagedResult.skippedSegments[0].reason)) {
      throw new Error(`Missing actionable damaged-source warning: ${JSON.stringify(damagedResult.skippedSegments)}`);
    }
    const leftovers = (await fs.readdir(exportPath)).filter((name) => name.startsWith(".grayfox-render-"));
    if (leftovers.length) throw new Error(`Temporary render folders were not removed: ${leftovers.join(", ")}`);

    process.stdout.write(`GRAYFOX_EDIT_RESILIENCE_OK ${JSON.stringify({
      sourceDuration: longResult.sourceDuration,
      longOutputDuration: longDuration,
      longSegments: longResult.segmentCount,
      productionDuration,
      productionSegments: productionResult.segmentCount,
      productionMeetsTarget: productionResult.meetsTarget,
      recoveredDuration,
      recoveredSegments: damagedResult.segmentCount,
      skippedSegments: damagedResult.skippedSegments.length,
      warning: damagedResult.skippedSegments[0].reason,
    })}\n`);
  } finally {
    const tempRoot = path.resolve(app.getPath("temp"));
    const resolvedTestRoot = path.resolve(testRoot);
    if (resolvedTestRoot.startsWith(`${tempRoot}${path.sep}`) && path.basename(resolvedTestRoot).startsWith("grayfox-edit-resilience-")) {
      await fs.rm(resolvedTestRoot, { recursive: true, force: true });
    }
  }
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
