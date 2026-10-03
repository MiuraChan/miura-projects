const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow } = require("electron");

const sourcePath = path.resolve(process.argv[2] || "");

app.whenReady().then(async () => {
  await fs.access(sourcePath);
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  await window.loadFile(path.join(__dirname, "..", "index.html"));
  const sourceUrl = pathToFileURL(sourcePath).href;
  const result = await window.webContents.executeJavaScript(`new Promise((resolve) => {
    const video = document.querySelector("#video-preview");
    const timer = setTimeout(() => resolve({ ok: false, reason: "metadata timeout", readyState: video.readyState }), 30000);
    video.addEventListener("loadeddata", () => {
      clearTimeout(timer);
      resolve({ ok: true, duration: video.duration, width: video.videoWidth, height: video.videoHeight, readyState: video.readyState });
    }, { once: true });
    video.addEventListener("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: video.error?.message || "media error", code: video.error?.code || 0, readyState: video.readyState });
    }, { once: true });
    video.src = ${JSON.stringify(sourceUrl)};
    video.load();
  })`, true);
  if (!result.ok) throw new Error(`Preview failed: ${JSON.stringify(result)}`);
  process.stdout.write(`GRAYFOX_PREVIEW_OK ${JSON.stringify({ source: path.basename(sourcePath), ...result })}\n`);
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
