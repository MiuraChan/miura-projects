const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { selectRuntime, sha256, validateRuntime } = require("../electron/runtime-loader.cjs");

function createRuntimeFixture(version = "0.2.4") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grayfox-runtime-"));
  const packagedRoot = path.join(root, "packaged");
  const userDataPath = path.join(root, "user-data");
  const buildId = `${version}-local-test`;
  const runtimeRoot = path.join(userDataPath, "runtime-updates", "releases", buildId);
  fs.mkdirSync(path.join(packagedRoot, "electron"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "electron"), { recursive: true });
  fs.writeFileSync(path.join(packagedRoot, "electron", "main.cjs"), "module.exports = 'packaged';\n");
  fs.writeFileSync(path.join(runtimeRoot, "electron", "main.cjs"), "module.exports = 'updated';\n");
  const manifest = {
    schema: 1,
    version,
    buildId,
    entry: "electron/main.cjs",
    files: { "electron/main.cjs": sha256(path.join(runtimeRoot, "electron", "main.cjs")) },
  };
  fs.writeFileSync(path.join(runtimeRoot, "runtime-manifest.json"), JSON.stringify(manifest));
  fs.mkdirSync(path.join(userDataPath, "runtime-updates"), { recursive: true });
  fs.writeFileSync(path.join(userDataPath, "runtime-updates", "active.json"), JSON.stringify({ buildId }));
  return { root, packagedRoot, userDataPath, runtimeRoot, manifest };
}

describe("Grayfox local runtime updates", () => {
  const fixtures = [];
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  it("selects a complete checksum-verified local runtime", () => {
    const fixture = createRuntimeFixture();
    fixtures.push(fixture);
    const selected = selectRuntime({ packagedRoot: fixture.packagedRoot, userDataPath: fixture.userDataPath, packagedVersion: "0.2.4" });
    expect(selected.source).toBe("local-update");
    expect(selected.entryPath).toBe(path.join(fixture.runtimeRoot, "electron", "main.cjs"));
  });

  it("falls back to the packaged runtime when an update is modified", () => {
    const fixture = createRuntimeFixture();
    fixtures.push(fixture);
    fs.appendFileSync(path.join(fixture.runtimeRoot, "electron", "main.cjs"), "tampered\n");
    const selected = selectRuntime({ packagedRoot: fixture.packagedRoot, userDataPath: fixture.userDataPath, packagedVersion: "0.2.4" });
    expect(selected.source).toBe("packaged");
  });

  it("rejects manifest paths outside the runtime directory", () => {
    const fixture = createRuntimeFixture();
    fixtures.push(fixture);
    const result = validateRuntime(fixture.runtimeRoot, { ...fixture.manifest, entry: "../main.cjs", files: { "../main.cjs": "a".repeat(64) } });
    expect(result.valid).toBe(false);
  });
});
