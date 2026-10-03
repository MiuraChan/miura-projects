process.env.GRAYFOX_LIBRARY_MODE = "1";

const fs = require("node:fs/promises");
const path = require("node:path");
const { app } = require("electron");
app.setPath("userData", path.join(app.getPath("appData"), "grayfox-video-studio"));
const { saveWorkspaceToDisk, workspaceFilePath } = require("../electron/main.cjs");

const TEST_BRIEF = Object.freeze({
  name: "La storia, senza distrazioni",
  finalUse: "YouTube",
  minimumMinutes: 10,
  maximumMinutes: 30,
  tokens: ["Serious", "Energetic", "Direct", "Irreverent"],
  direction: [
    "Remove the entire section where I watch the previous video, including its setup, playback, and my reactions to it.",
    "Build the edit around the story I tell: preserve narrative order, keep my spoken storytelling central, cut dead air, repetition, and gameplay that does not serve the story, and make every cut support pacing and narrative clarity.",
    "Add memes wherever they strengthen a story beat without interrupting the storytelling.",
  ].join(" "),
});

async function applyTestBrief() {
  await app.whenReady();
  const filePath = workspaceFilePath();
  const workspace = JSON.parse(await fs.readFile(filePath, "utf8"));
  const projectIndex = workspace.projects.findIndex((project) => project.id === workspace.currentProjectId);
  if (projectIndex < 0) throw new Error("The current Grayfox project was not found.");

  const backupPath = `${filePath}.before-storytelling-brief`;
  await fs.copyFile(filePath, backupPath);

  const current = workspace.projects[projectIndex];
  workspace.projects[projectIndex] = {
    ...current,
    name: TEST_BRIEF.name,
    editor: {
      ...(current.editor || {}),
      finalUse: TEST_BRIEF.finalUse,
      minimumMinutes: TEST_BRIEF.minimumMinutes,
      maximumMinutes: TEST_BRIEF.maximumMinutes,
      direction: TEST_BRIEF.direction,
      tokens: [...TEST_BRIEF.tokens],
    },
    updatedAt: new Date().toISOString(),
  };

  await saveWorkspaceToDisk(workspace);
  process.stdout.write(`GRAYFOX_TEST_BRIEF_READY ${JSON.stringify({
    projectId: workspace.currentProjectId,
    title: TEST_BRIEF.name,
    finalUse: TEST_BRIEF.finalUse,
    duration: [TEST_BRIEF.minimumMinutes, TEST_BRIEF.maximumMinutes],
    tokens: TEST_BRIEF.tokens,
    backupPath,
  })}\n`);
  app.quit();
}

applyTestBrief().catch((error) => {
  process.stderr.write(`GRAYFOX_TEST_BRIEF_FAILED ${error.stack || error.message}\n`);
  app.exit(1);
});
