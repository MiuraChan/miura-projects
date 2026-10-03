const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { createLocalAi } = require("./local-ai.cjs");
const { createEditRenderer } = require("./edit-renderer.cjs");
const { createHandoff } = require("./handoff.cjs");

const execFileAsync = promisify(execFile);
const isSmokeTest = process.env.GRAYFOX_SMOKE_TEST === "1";
let smokeWorkspace = null;


function cleanText(value, fallback = "", limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : fallback;
}

function cleanSource(source) {
  if (!source || typeof source !== "object") return null;
  const sourcePath = cleanText(source.path, "", 2000);
  return {
    name: cleanText(source.name, "Video", 260),
    path: sourcePath && path.isAbsolute(sourcePath) ? path.normalize(sourcePath) : null,
    size: Number.isFinite(Number(source.size)) ? Number(source.size) : 0,
    lastModified: Number.isFinite(Number(source.lastModified)) ? Number(source.lastModified) : 0,
    duration: Number.isFinite(Number(source.duration)) ? Number(source.duration) : 0,
  };
}

function cleanProject(project, exportPath) {
  const editor = project?.editor || {};
  const shorts = project?.shorts || {};
  const trim = project?.trim || {};
  const editReview = project?.editReview || null;
  return {
    id: cleanText(project?.id, `project-${Date.now()}`, 120),
    name: cleanText(project?.name, "Untitled edit", 80),
    status: cleanText(project?.status, "Draft", 80),
    view: project?.view === "shorts" ? "shorts" : "video-ops",
    exportPath,
    source: cleanSource(project?.source || (project?.sourceName ? { name: project.sourceName } : null)),
    editor: {
      finalUse: cleanText(editor.finalUse, "Website / landing page", 100),
      targetMinutes: Math.max(0, Number(editor.targetMinutes) || 0),
      direction: cleanText(editor.direction, "", 5000),
      tokens: Array.isArray(editor.tokens) ? editor.tokens.slice(0, 6).map((token) => cleanText(token, "", 60)).filter(Boolean) : [],
    },
    shorts: {
      length: cleanText(shorts.length, "30–45 seconds", 60),
      platform: ["TikTok", "Reels", "Shorts"].includes(shorts.platform) ? shorts.platform : "TikTok",
      tone: cleanText(shorts.tone, "", 500),
    },
    trim: {
      start: Math.max(0, Number(trim.start) || 0),
      end: Math.max(0, Number(trim.end) || 0),
    },
    editReview: editReview && path.isAbsolute(String(editReview.outputPath || "")) ? {
      outputPath: path.normalize(String(editReview.outputPath)),
      duration: Math.max(0, Number(editReview.duration) || 0),
      targetDuration: Math.max(0, Number(editReview.targetDuration) || 0),
      approval: ["pending", "approved", "changes-requested"].includes(editReview.approval) ? editReview.approval : "pending",
      approvedAt: cleanText(editReview.approvedAt, "", 80) || null,
      segments: Array.isArray(editReview.segments) ? editReview.segments.slice(0, 64).map((segment) => ({
        start: Math.max(0, Number(segment.start) || 0),
        end: Math.max(0, Number(segment.end) || 0),
        role: cleanText(segment.role, "body", 30),
        effect: ["meme-punch", "meme-monochrome", "meme-flash"].includes(segment.effect) ? segment.effect : null,
        memeEnabled: ["meme-punch", "meme-monochrome", "meme-flash"].includes(segment.effect) && segment.memeEnabled !== false,
        memeSuggested: segment.memeSuggested === true,
        memeStart: Math.max(0, Number(segment.memeStart) || 0),
        memeEnd: Math.max(0, Number(segment.memeEnd) || 0),
        memeReason: cleanText(segment.memeReason, "", 300),
      })).filter((segment) => segment.end > segment.start) : [],
    } : null,
    lastExportPath: cleanText(project?.lastExportPath, "", 2000) || null,
    thumbnail: typeof project?.thumbnail === "string"
      && /^data:image\/jpeg;base64,/i.test(project.thumbnail)
      && project.thumbnail.length <= 300000
      ? project.thumbnail
      : null,
    updatedAt: cleanText(project?.updatedAt, new Date().toISOString(), 80),
  };
}

function cleanWorkspace(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid workspace.");
  const userName = cleanText(payload.userName, "", 100);
  const exportPath = cleanText(payload.exportPath, "", 2000);
  const profileImage = typeof payload.profileImage === "string"
    && /^data:image\/(png|jpeg|webp);base64,/i.test(payload.profileImage)
    && payload.profileImage.length <= 3000000
    ? payload.profileImage
    : null;
  if (!userName || !path.isAbsolute(exportPath)) throw new Error("A name and absolute export folder are required.");
  const normalizedExportPath = path.normalize(exportPath);
  const projects = Array.isArray(payload.projects)
    ? payload.projects.slice(0, 100).map((project) => cleanProject(project, normalizedExportPath))
    : [];
  const currentProjectId = cleanText(payload.currentProjectId, "", 120) || projects[0]?.id || null;
  return { version: 3, userName, exportPath: normalizedExportPath, profileImage, currentProjectId, projects };
}

function workspaceFilePath() {
  return path.join(app.getPath("userData"), "grayfox-workspace.json");
}

function cleanWorkspaceForStorage(payload) {
  const workspace = cleanWorkspace(payload);
  return {
    ...workspace,
    projects: workspace.projects.map((project) => ({
      ...project,
      source: project.source ? {
        name: project.source.name,
        path: null,
        size: 0,
        lastModified: 0,
        duration: project.source.duration,
      } : null,
      lastExportPath: null,
    })),
  };
}

async function loadWorkspaceFromDisk() {
  try {
    const raw = await fs.readFile(workspaceFilePath(), "utf8");
    return cleanWorkspaceForStorage(JSON.parse(raw));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

async function saveWorkspaceToDisk(payload) {
  const workspace = cleanWorkspaceForStorage(payload);
  const filePath = workspaceFilePath();
  const temporaryPath = filePath + ".tmp";
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, JSON.stringify(workspace, null, 2), "utf8");
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EEXIST") throw error;
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
  }
  return workspace;
}

async function describeVideo(filePath) {
  const stats = await fs.stat(filePath);
  return {
    name: path.basename(filePath),
    path: path.normalize(filePath),
    url: pathToFileURL(filePath).href,
    size: stats.size,
    lastModified: stats.mtimeMs,
  };
}

async function resolveMediaTool(toolName) {
  const executable = process.platform === "win32" ? `${toolName}.exe` : toolName;
  const configured = process.env[`GRAYFOX_${toolName.toUpperCase()}_PATH`];
  const candidates = [
    configured,
    process.resourcesPath ? path.join(process.resourcesPath, "bin", executable) : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "scoop", "apps", "ffmpeg", "current", "bin", executable) : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", executable) : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch { /* Try the next known location. */ }
  }
  try {
    const command = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(command, [executable], { windowsHide: true });
    const found = stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
    if (found) return found;
  } catch { /* Report one actionable error below. */ }
  throw new Error(`${toolName} is not installed or could not be found. Install FFmpeg, then restart Grayfox.`);
}

async function probeDuration(filePath, ffprobePath = null) {
  const toolPath = ffprobePath || await resolveMediaTool("ffprobe");
  const { stdout } = await execFileAsync(toolPath, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], { windowsHide: true });
  const duration = Number.parseFloat(stdout);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not read video duration.");
  return duration;
}

const { analyzeVideo } = createLocalAi({ resolveMediaTool, probeDuration, cleanText });
const { produceEditedVideo } = createEditRenderer({ resolveMediaTool, probeDuration, cleanText });
const handoffApprovedEdit = createHandoff({ shell });

async function produceVideo(event, payload) {
  const sourcePath = cleanText(payload?.sourcePath, "", 2000);
  const exportPath = cleanText(payload?.exportPath, "", 2000);
  if (!path.isAbsolute(sourcePath) || !path.isAbsolute(exportPath)) throw new Error("Invalid source or export path.");
  await fs.access(sourcePath);
  await fs.mkdir(exportPath, { recursive: true });
  const ffprobePath = await resolveMediaTool("ffprobe");
  const ffmpegPath = await resolveMediaTool("ffmpeg");
  const fullDuration = await probeDuration(sourcePath, ffprobePath);
  const start = Math.min(Math.max(0, Number(payload?.trimStart) || 0), fullDuration - 0.05);
  const requestedEnd = Number(payload?.trimEnd) || fullDuration;
  const end = Math.min(Math.max(requestedEnd, start + 0.05), fullDuration);
  const renderDuration = end - start;
  const safeName = cleanText(payload?.projectName, "Grayfox export", 80).replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/[. ]+$/g, "") || "Grayfox export";
  const outputPath = path.join(exportPath, `${safeName}-${Date.now()}.mp4`);
  const args = ["-y", "-ss", String(start), "-i", sourcePath, "-t", String(renderDuration), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", outputPath];

  await new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    let stdoutBuffer = "";
    process.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const [key, value] = line.split("=");
        if (key === "out_time_ms") {
          const seconds = Number(value) / 1000000;
          const percent = Math.max(0, Math.min(99, Math.round((seconds / renderDuration) * 100)));
          event.sender.send("video:production-progress", { percent, outputPath });
        }
      }
    });
    process.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
    process.on("error", (error) => reject(new Error(`FFmpeg unavailable: ${error.message}`)));
    process.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited with code ${code}.`)));
  });
  event.sender.send("video:production-progress", { percent: 100, outputPath });
  return { outputPath, duration: renderDuration };
}

function registerWorkspaceIpc() {
  ipcMain.handle("workspace:choose-export-path", async () => {
    const result = await dialog.showOpenDialog({ title: "Choose where Grayfox exports your videos", buttonLabel: "Use this folder", properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("workspace:load", async () => isSmokeTest ? smokeWorkspace : loadWorkspaceFromDisk());
  ipcMain.handle("workspace:save", async (_event, payload) => {
    if (isSmokeTest) {
      smokeWorkspace = cleanWorkspaceForStorage(payload);
      return smokeWorkspace;
    }
    return saveWorkspaceToDisk(payload);
  });
  ipcMain.handle("video:choose", async () => {
    const result = await dialog.showOpenDialog({ title: "Choose a source video", buttonLabel: "Use this video", properties: ["openFile"], filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv", "webm", "m4v", "avi"] }] });
    return result.canceled ? null : describeVideo(result.filePaths[0]);
  });
  ipcMain.handle("dialogue:choose", async () => {
    const result = await dialog.showOpenDialog({
      title: "Attach a dialogue transcript",
      buttonLabel: "Use this transcript",
      properties: ["openFile"],
      filters: [{ name: "Subtitles", extensions: ["srt", "vtt"] }],
    });
    if (result.canceled) return null;
    return { name: path.basename(result.filePaths[0]), path: result.filePaths[0] };
  });  ipcMain.handle("video:restore", async (_event, filePath) => {
    try { return await describeVideo(filePath); } catch { return null; }
  });
  ipcMain.handle("video:tools", async () => ({
    ffmpeg: await resolveMediaTool("ffmpeg"),
    ffprobe: await resolveMediaTool("ffprobe"),
  }));
  ipcMain.handle("video:analyze", analyzeVideo);
  ipcMain.handle("video:produce", produceVideo);
  ipcMain.handle("video:produce-edit", produceEditedVideo);
  ipcMain.handle("video:handoff", handoffApprovedEdit);
}

function createWindow() {
  const mainWindow = new BrowserWindow({ width: 1280, height: 820, minWidth: 390, minHeight: 680, show: !isSmokeTest, backgroundColor: "#FAFAF8", autoHideMenuBar: true, title: "Grayfox", webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false } });
  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith("https://")) shell.openExternal(url); return { action: "deny" }; });
  mainWindow.webContents.on("will-navigate", (event, url) => { if (url !== mainWindow.webContents.getURL()) event.preventDefault(); });
  if (isSmokeTest) mainWindow.webContents.once("did-finish-load", async () => {
    const result = await mainWindow.webContents.executeJavaScript(`(async () => {
      await window.grayfoxDesktop.saveWorkspace({ userName: "Smoke", exportPath: "C:/GrayfoxSmoke", projects: [] });
      const loadedWorkspace = await window.grayfoxDesktop.loadWorkspace();
      return {
        title: document.title,
        hasApp: Boolean(window.GrayfoxApp),
        hasVideoOps: Boolean(document.querySelector("#video-ops")),
        hasStoryClips: Boolean(document.querySelector("#shorts")),
        onboardingVisible: !document.querySelector("#workspace-modal").hidden,
        persistenceEnabled: loadedWorkspace?.userName === "Smoke" && /GrayfoxSmoke$/.test(loadedWorkspace?.exportPath || ""),
      };
    })()`);
    const passed = result.hasApp && result.hasVideoOps && result.hasStoryClips && result.onboardingVisible && result.persistenceEnabled;
    process.stdout.write(`GRAYFOX_SMOKE_${passed ? "OK" : "FAIL"} ${JSON.stringify(result)}\n`);
    if (passed) app.quit(); else app.exit(1);
  });
  return mainWindow;
}

if (process.env.GRAYFOX_LIBRARY_MODE !== "1") {
  app.whenReady().then(() => { registerWorkspaceIpc(); createWindow(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}

module.exports = { analyzeVideo, cleanWorkspace, cleanWorkspaceForStorage, createWindow, describeVideo, handoffApprovedEdit, loadWorkspaceFromDisk, probeDuration, produceEditedVideo, produceVideo, registerWorkspaceIpc, resolveMediaTool, saveWorkspaceToDisk, workspaceFilePath };