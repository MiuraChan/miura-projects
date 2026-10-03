const path = require("node:path");
const { app } = require("electron");
const { selectRuntime } = require("./runtime-loader.cjs");

const packagedRoot = path.join(__dirname, "..");
const disableUpdates = process.env.GRAYFOX_SMOKE_TEST === "1" || process.env.GRAYFOX_DISABLE_RUNTIME_UPDATES === "1";
const selected = selectRuntime({
  packagedRoot,
  userDataPath: app.getPath("userData"),
  packagedVersion: app.getVersion(),
  disableUpdates,
});

process.env.GRAYFOX_RUNTIME_VERSION = selected.version;
process.env.GRAYFOX_RUNTIME_BUILD = selected.buildId;
process.env.GRAYFOX_UPDATE_CHANNEL = selected.source;

try {
  require(selected.entryPath);
} catch (error) {
  if (selected.source !== "local-update") throw error;
  process.stderr.write(`Grayfox local update ${selected.buildId} failed during startup; using packaged runtime. ${error.message}\n`);
  process.env.GRAYFOX_RUNTIME_VERSION = app.getVersion();
  process.env.GRAYFOX_RUNTIME_BUILD = app.getVersion();
  process.env.GRAYFOX_UPDATE_CHANNEL = "packaged-fallback";
  require(path.join(packagedRoot, "electron", "main.cjs"));
}
