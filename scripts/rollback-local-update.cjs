const path = require("node:path");
const fs = require("node:fs/promises");
const { app } = require("electron");
const packageJson = require("../package.json");

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); } catch { return null; }
}

async function replaceJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rm(filePath, { force: true });
  await fs.rename(temporaryPath, filePath);
}

async function rollback() {
  const updateRoot = path.join(process.env.GRAYFOX_USER_DATA_PATH || path.join(app.getPath("appData"), packageJson.name), "runtime-updates");
  const activePath = path.join(updateRoot, "active.json");
  const previousPath = path.join(updateRoot, "previous.json");
  const active = await readJson(activePath);
  const previous = await readJson(previousPath);
  if (!previous?.buildId) throw new Error("No previous Grayfox runtime update is available.");
  await replaceJson(activePath, { ...previous, activatedAt: new Date().toISOString(), rollback: true });
  if (active?.buildId) await replaceJson(previousPath, active);
  process.stdout.write(`GRAYFOX_LOCAL_UPDATE_ROLLBACK ${JSON.stringify({ buildId: previous.buildId, restartRequired: true })}\n`);
}

rollback().then(() => app.exit(0)).catch((error) => { process.stderr.write(`${error.message}\n`); app.exit(1); });
