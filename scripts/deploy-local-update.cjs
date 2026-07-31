const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { app } = require("electron");
const { validateRuntime } = require("../electron/runtime-loader.cjs");

const projectRoot = path.join(__dirname, "..");
const packageJson = require(path.join(projectRoot, "package.json"));
const runtimeFiles = ["index.html", "styles.css", "app.js", "package.json", "assets", "electron"];

async function listFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(root, fullPath));
    else output.push(path.relative(root, fullPath).split(path.sep).join("/"));
  }
  return output;
}

async function hashFile(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); } catch { return null; }
}

async function replaceJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rm(filePath, { force: true });
  await fs.rename(temporaryPath, filePath);
}

async function deploy() {
  const updateRoot = path.join(process.env.GRAYFOX_USER_DATA_PATH || path.join(app.getPath("appData"), packageJson.name), "runtime-updates");
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const buildId = `${packageJson.version}-local-${timestamp}`;
  const releasesRoot = path.join(updateRoot, "releases");
  const stagingRoot = path.join(releasesRoot, `.staging-${buildId}`);
  const targetRoot = path.join(releasesRoot, buildId);
  await fs.mkdir(releasesRoot, { recursive: true });
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.mkdir(stagingRoot, { recursive: true });
  for (const relativePath of runtimeFiles) {
    await fs.cp(path.join(projectRoot, relativePath), path.join(stagingRoot, relativePath), { recursive: true });
  }
  const files = {};
  for (const relativePath of await listFiles(stagingRoot)) {
    if (relativePath === "runtime-manifest.json") continue;
    files[relativePath] = await hashFile(path.join(stagingRoot, ...relativePath.split("/")));
  }
  const manifest = { schema: 1, version: packageJson.version, buildId, entry: "electron/main.cjs", createdAt: new Date().toISOString(), files };
  await fs.writeFile(path.join(stagingRoot, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const validation = validateRuntime(stagingRoot, manifest);
  if (!validation.valid) throw new Error(`Runtime validation failed before activation: ${validation.reason}`);
  await fs.rename(stagingRoot, targetRoot);
  const activePath = path.join(updateRoot, "active.json");
  const previous = await readJson(activePath);
  if (previous?.buildId) await replaceJson(path.join(updateRoot, "previous.json"), previous);
  await replaceJson(activePath, { schema: 1, version: packageJson.version, buildId, activatedAt: new Date().toISOString() });
  process.stdout.write(`GRAYFOX_LOCAL_UPDATE_READY ${JSON.stringify({ version: packageJson.version, buildId, targetRoot, restartRequired: true })}\n`);
}

deploy().then(() => app.exit(0)).catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); app.exit(1); });
