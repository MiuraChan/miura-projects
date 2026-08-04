process.env.GRAYFOX_LIBRARY_MODE = "1";

const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app } = require("electron");
const {
  analyzeVideo,
  probeDuration,
  produceVideo,
  resolveMediaTool,
} = require("../electron/main.cjs");

const execFileAsync = promisify(execFile);

async function main() {
  await app.whenReady();
  const testRoot = path.join(app.getPath("temp"), `grayfox-local-ai-${process.pid}-${Date.now()}`);
  const sourcePath = path.join(testRoot, "semantic-source.mp4");
  const exportPath = path.join(testRoot, "exports");
  await fs.mkdir(testRoot, { recursive: true });

  try {
    const ffmpegPath = await resolveMediaTool("ffmpeg");
    await execFileAsync(ffmpegPath, [
      "-y",
      "-f", "lavfi", "-i", "color=c=0xC41E1E:s=640x360:r=25:d=5",
      "-f", "lavfi", "-i", "color=c=0x151515:s=640x360:r=25:d=5",
      "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=5",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=15",
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
      "-map", "[v]", "-map", "3:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      sourcePath,
    ], { windowsHide: true });

    const analysis = await analyzeVideo({}, {
      sourcePath,
      targetLength: 4,
      finalUse: "Story clip for Reels",
      tone: "bold, funny, meme",
      direction: "Choose the clearest visual hook and evaluate text-overlay potential.",
    });

    if (analysis.provider !== "lm-studio-qwen3-vl" || analysis.model !== "qwen/qwen3-vl-4b") {
      throw new Error(`Expected LM Studio Qwen3-VL analysis, received ${analysis.provider}: ${analysis.fallbackReason || "unknown reason"}`);
    }
    if (analysis.candidates.length !== 3) throw new Error("Expected three ranked candidates.");
    for (const candidate of analysis.candidates) {
      if (!Number.isFinite(candidate.score) || !Number.isFinite(candidate.memeScore)) {
        throw new Error("Semantic or meme score is missing.");
      }
      if (!(candidate.end > candidate.start)) throw new Error("Candidate range is invalid.");
    }

    const selected = analysis.candidates[0];
    const progress = [];
    const rendered = await produceVideo({
      sender: { send: (_channel, value) => progress.push(value.percent) },
    }, {
      sourcePath,
      exportPath,
      projectName: "Local AI selected clip",
      trimStart: selected.start,
      trimEnd: selected.end,
    });
    const duration = await probeDuration(rendered.outputPath);
    if (Math.abs(duration - (selected.end - selected.start)) > 0.2) {
      throw new Error(`Rendered duration ${duration} does not match selected range.`);
    }
    if (!progress.includes(100)) throw new Error("Rendering never reported 100%.");

    process.stdout.write(`GRAYFOX_LOCAL_AI_OK ${JSON.stringify({
      provider: analysis.provider,
      model: analysis.model,
      sceneCount: analysis.sceneCount,
      selected: {
        start: selected.start,
        end: selected.end,
        score: selected.score,
        memeScore: selected.memeScore,
        title: selected.title,
      },
      renderedDuration: Number(duration.toFixed(2)),
    })}\n`);
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
    app.quit();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
