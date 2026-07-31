const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function versionParts(value) {
  return String(value || "0").split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function safeRuntimeFile(runtimeRoot, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) return null;
  const resolvedRoot = path.resolve(runtimeRoot);
  const resolvedFile = path.resolve(resolvedRoot, relativePath);
  return resolvedFile.startsWith(`${resolvedRoot}${path.sep}`) ? resolvedFile : null;
}

function validateRuntime(runtimeRoot, manifest) {
  if (!manifest || manifest.schema !== 1 || typeof manifest.version !== "string") {
    return { valid: false, reason: "Invalid runtime manifest." };
  }
  const entries = Object.entries(manifest.files || {});
  if (!entries.length) return { valid: false, reason: "Runtime manifest has no files." };
  const entryPath = safeRuntimeFile(runtimeRoot, manifest.entry);
  if (!entryPath || !manifest.files[manifest.entry]) return { valid: false, reason: "Runtime entry is not verified." };
  for (const [relativePath, expectedHash] of entries) {
    const filePath = safeRuntimeFile(runtimeRoot, relativePath);
    if (!filePath || !/^[a-f0-9]{64}$/i.test(expectedHash || "") || !fs.existsSync(filePath)) {
      return { valid: false, reason: `Missing or unsafe runtime file: ${relativePath}` };
    }
    if (sha256(filePath) !== expectedHash.toLowerCase()) {
      return { valid: false, reason: `Runtime checksum mismatch: ${relativePath}` };
    }
  }
  return { valid: true, entryPath, version: manifest.version, buildId: manifest.buildId || manifest.version };
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function selectRuntime({ packagedRoot, userDataPath, packagedVersion, disableUpdates = false }) {
  const packaged = {
    source: "packaged",
    root: packagedRoot,
    entryPath: path.join(packagedRoot, "electron", "main.cjs"),
    version: packagedVersion,
    buildId: packagedVersion,
  };
  if (disableUpdates) return packaged;
  const updatesRoot = path.join(userDataPath, "runtime-updates");
  const active = readJson(path.join(updatesRoot, "active.json"));
  if (!active?.buildId || !/^[a-zA-Z0-9._-]+$/.test(active.buildId)) return packaged;
  const runtimeRoot = path.join(updatesRoot, "releases", active.buildId);
  const manifest = readJson(path.join(runtimeRoot, "runtime-manifest.json"));
  const validation = validateRuntime(runtimeRoot, manifest);
  if (!validation.valid || compareVersions(validation.version, packagedVersion) < 0) return packaged;
  return { source: "local-update", root: runtimeRoot, ...validation };
}

module.exports = { compareVersions, safeRuntimeFile, selectRuntime, sha256, validateRuntime };
