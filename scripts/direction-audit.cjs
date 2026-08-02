process.env.GRAYFOX_LIBRARY_MODE = "1";

const fs = require("node:fs/promises");
const { app } = require("electron");
const { analyzeVideo } = require("../electron/main.cjs");

async function main() {
  await app.whenReady();
  const sourcePath = process.argv[2];
  const targetLength = Number(process.argv[3]) || 1800;
  const direction = process.argv.slice(4).join(" ") || "Remove the section in which we rewatch the old episode. Cut more of the game, it is not important. Me talking and the story are important. Add tasteful meme beats where visually justified.";
  if (!sourcePath) throw new Error("Usage: electron scripts/direction-audit.cjs <video> [targetSeconds] [direction]");
  await fs.access(sourcePath);
  try {
    const analysis = await analyzeVideo({}, {
      mode: "edit",
      sourcePath,
      targetLength,
      segmentLength: 6,
      finalUse: "YouTube long-form production",
      tone: "energetic, direct, storytelling, fun, entertaining",
      direction,
    });
    const overlaps = (analysis.editPlan?.segments || []).flatMap((segment) =>
      (analysis.excludedRanges || []).filter((range) => segment.start < range.end && segment.end > range.start)
        .map((range) => ({ segment, range }))
    );
    const result = {
      provider: analysis.provider,
      model: analysis.model,
      sourceDuration: analysis.duration,
      targetLength: analysis.targetLength,
      directionRules: analysis.directionRules,
      directionAuditCount: analysis.directionAuditCount,
      excludedRanges: analysis.excludedRanges,
      outputDuration: analysis.editPlan?.outputDuration,
      hardExclusionsApplied: analysis.editPlan?.hardExclusionsApplied,
      overlapCount: overlaps.length,
      memeBeatCount: analysis.memeBeatCount,
      decisionCounts: (analysis.timelineReviews || []).reduce((counts, review) => ({ ...counts, [review.decision]: (counts[review.decision] || 0) + 1 }), {}),
      removalCandidates: (analysis.timelineReviews || []).filter((review) => review.decision === "remove" || /episode|replay|game|twitch|player/i.test(review.reason || "")),
      fallbackReason: analysis.fallbackReason,
    };
    process.stdout.write(`GRAYFOX_DIRECTION_AUDIT ${JSON.stringify(result)}\n`);
    if (!analysis.directionAuditCount) throw new Error("The full timeline was not reviewed.");
    if (!analysis.excludedRanges.length) throw new Error("No mandatory removal range was found.");
    if (overlaps.length) throw new Error(`Edit plan crosses ${overlaps.length} hard exclusion ranges.`);
    if (Math.abs((analysis.editPlan?.outputDuration || 0) - targetLength) > 2) throw new Error("The edit plan missed the requested duration.");
  } finally {
    app.quit();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});