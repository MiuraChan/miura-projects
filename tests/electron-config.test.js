const fs = require("node:fs");
const path = require("node:path");
const projectRoot = path.join(__dirname, "..");
const mainSource = fs.readFileSync(path.join(projectRoot, "electron", "main.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.join(projectRoot, "electron", "preload.cjs"), "utf8");
const stylesSource = fs.readFileSync(path.join(projectRoot, "styles.css"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const headerArtPath = path.join(projectRoot, "assets", "grayfox-header-v2.webp");

describe("Grayfox identity motion", () => {
  it("ships the blinking signal and reduced-motion guard", () => {
    expect(stylesSource).toContain("@keyframes grayfox-signal");
    expect(fs.existsSync(headerArtPath)).toBe(true);
    expect(stylesSource).toContain("grayfox-header-v2.webp");
    expect(stylesSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(stylesSource).toContain("animation: none !important");
  });
});
describe("Electron production configuration", () => {
  it("uses an isolated sandboxed renderer without Node integration", () => {
    expect(mainSource).toContain("contextIsolation: true");
    expect(mainSource).toContain("nodeIntegration: false");
    expect(mainSource).toContain("sandbox: true");
    expect(mainSource).toContain("webSecurity: true");
    expect(mainSource).toContain("allowRunningInsecureContent: false");
  });

  it("blocks untrusted navigation and new in-app windows", () => {
    expect(mainSource).toContain("setWindowOpenHandler");
    expect(mainSource).toContain('return { action: "deny" }');
    expect(mainSource).toContain('"will-navigate"');
    expect(mainSource).toContain("event.preventDefault()");
  });

  it("keeps workspace data session-only and exposes the real FFmpeg bridge", () => {
    expect(mainSource).toContain('ipcMain.handle("workspace:choose-export-path"');
    expect(mainSource).toContain('ipcMain.handle("workspace:load", async () => null)');
    expect(mainSource).toContain('ipcMain.handle("workspace:save"');
    expect(mainSource).not.toContain("workspace.json");
    expect(mainSource).not.toContain("fs.writeFile");
    expect(preloadSource).toContain('ipcRenderer.invoke("workspace:choose-export-path")');
    expect(mainSource).toContain('ipcMain.handle("video:choose"');
    expect(mainSource).toContain('ipcMain.handle("video:restore"');
    expect(mainSource).toContain('ipcMain.handle("video:tools"');
    expect(mainSource).toContain('ipcMain.handle("video:produce"');
    expect(mainSource).toContain('ipcMain.handle("video:analyze"');
    expect(mainSource).toContain("spawn(ffmpegPath");
    expect(preloadSource).toContain('ipcRenderer.invoke("video:tools")');
    expect(preloadSource).toContain('ipcRenderer.invoke("video:produce", options)');
    expect(preloadSource).toContain('ipcRenderer.invoke("video:analyze", options)');
  });
  it("packages the required renderer and Electron files", () => {
    expect(packageJson.main).toBe("electron/main.cjs");
    expect(packageJson.build.files).toEqual(expect.arrayContaining([
      "index.html",
      "styles.css",
      "app.js",
      "assets/**/*",
      "electron/**/*"
    ]));
  });

  it("builds a named Windows portable executable", () => {
    expect(packageJson.build.win.target).toContain("portable");
    expect(packageJson.build.win.artifactName).toBe("Grayfox-${version}-Windows.${ext}");
  });
});
