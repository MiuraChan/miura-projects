const fs = require("node:fs");
const path = require("node:path");
const projectRoot = path.join(__dirname, "..");
const mainSource = fs.readFileSync(path.join(projectRoot, "electron", "main.cjs"), "utf8");
const bootstrapSource = fs.readFileSync(path.join(projectRoot, "electron", "bootstrap.cjs"), "utf8");
const runtimeLoaderSource = fs.readFileSync(path.join(projectRoot, "electron", "runtime-loader.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.join(projectRoot, "electron", "preload.cjs"), "utf8");
const stylesSource = fs.readFileSync(path.join(projectRoot, "styles.css"), "utf8");
const localAiSource = fs.readFileSync(path.join(projectRoot, "electron", "local-ai.cjs"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const headerArtPath = path.join(projectRoot, "assets", "grayfox-header-v2.webp");

describe("Grayfox identity motion", () => {
  it("ships the blinking signal and reduced-motion guard", () => {
    expect(stylesSource).toContain("@keyframes grayfox-signal");
    expect(fs.existsSync(headerArtPath)).toBe(false);
    expect(stylesSource).not.toContain("grayfox-header-v2.webp");
    expect(stylesSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(stylesSource).toContain("animation: none !important");
  });
  it("centers the desktop shell and caps it at 1920 pixels", () => {
    expect(stylesSource).toMatch(/\.app-shell\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*1920px;[^}]*margin:\s*0 auto;/);
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

  it("persists sanitized workspace preferences and exposes the real FFmpeg bridge", () => {
    expect(mainSource).toContain('ipcMain.handle("workspace:choose-export-path"');
    expect(mainSource).toContain('ipcMain.handle("workspace:load"');
    expect(mainSource).toContain('ipcMain.handle("workspace:save"');
    expect(mainSource).toContain('grayfox-workspace.json');
    expect(mainSource).toContain('cleanWorkspaceForStorage');
    expect(mainSource).toContain('path: project.source.path');
    expect(mainSource).not.toContain('path: null,\n        size: 0');
    expect(mainSource).toContain('fs.writeFile');
    expect(preloadSource).toContain('ipcRenderer.invoke("workspace:choose-export-path")');
    expect(mainSource).toContain('ipcMain.handle("video:choose"');
    expect(mainSource).toContain('ipcMain.handle("video:restore"');
    expect(mainSource).toContain('ipcMain.handle("video:find-near-export"');
    expect(preloadSource).toContain('ipcRenderer.invoke("video:find-near-export", options)');
    expect(mainSource).toContain('ipcMain.handle("dialogue:choose"');
    expect(preloadSource).toContain('ipcRenderer.invoke("dialogue:choose"');
    expect(mainSource).toContain('ipcMain.handle("video:tools"');
    expect(mainSource).toContain('ipcMain.handle("video:produce"');
    expect(mainSource).toContain('ipcMain.handle("video:analyze"');
    expect(mainSource).toContain("spawn(ffmpegPath");
    expect(preloadSource).toContain('ipcRenderer.invoke("video:tools")');
    expect(preloadSource).toContain('ipcRenderer.invoke("video:produce", options)');
    expect(preloadSource).toContain('ipcRenderer.invoke("video:analyze", options)');
    expect(mainSource).toContain('ipcMain.handle("meme:search"');
    expect(preloadSource).toContain('ipcRenderer.invoke("meme:search", options)');
    expect(mainSource).toContain("minimumMinutes");
    expect(mainSource).toContain("maximumMinutes");
    expect(mainSource).toContain("briefSignature");
    expect(mainSource).toContain("toneProfile");
    expect(localAiSource).toContain("editPlan.toneProfile?.memeThreshold");
    expect(localAiSource).toContain("minimumDuration");
    expect(localAiSource).toContain("maximumDuration");
    expect(mainSource).toContain('ipcMain.handle("video:handoff"');
    expect(preloadSource).toContain('ipcRenderer.invoke("video:handoff", options)');
    expect(mainSource).toContain('ipcMain.handle("video:export-approved"');
    expect(preloadSource).toContain('ipcRenderer.invoke("video:export-approved", options)');
  });
  it("can wake the installed LM Studio service before local vision inference", () => {
    expect(localAiSource).toContain('path.join(process.env.USERPROFILE, ".lmstudio", "bin", executable)');
    expect(localAiSource).toContain('["server", "start"]');
    expect(localAiSource).toContain("ensureLmStudioServer(endpoint)");
    expect(localAiSource).toContain("grayfox_meme_ranking");
  });
  it("packages the required renderer and Electron files", () => {
    expect(packageJson.main).toBe("electron/bootstrap.cjs");
    expect(bootstrapSource).toContain("selectRuntime");
    expect(runtimeLoaderSource).toContain("validateRuntime");
    expect(packageJson.scripts["deploy:update-local"]).toContain("deploy-local-update.cjs");
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
