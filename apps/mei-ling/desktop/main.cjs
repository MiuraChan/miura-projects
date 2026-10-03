const { app, BrowserWindow, session } = require("electron");
const { spawn } = require("node:child_process");
const { appendFileSync, existsSync, mkdirSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const {
  createStagedRuntimeStartup,
  waitForHttpServer,
} = require("./startup-readiness.cjs");
const { withWindowsSystemCa } = require("./system-ca.cjs");

const APP_VERSION = "11";
const MODEL_ALIAS = "mei-ling-qwen3-4b-instruct";
const VOICE_FAIL_OPEN_MS = 15_000;
const PROJECT_ROOT = path.resolve(__dirname, "..");
const children = new Set();
let mainWindow = null;
let shuttingDown = false;
let runtimeLog = "";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function writeLog(message) {
  const line = `${new Date().toISOString()} ${String(message).trim()}\n`;
  if (!runtimeLog) return;
  try {
    appendFileSync(runtimeLog, line, "utf8");
  } catch {
    // Logging must never take down the assistant.
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function spawnService(label, command, args, env) {
  writeLog(`${label}: starting ${command}`);
  const child = spawn(command, args, {
    cwd: app.isPackaged ? app.getPath("userData") : PROJECT_ROOT,
    env: withWindowsSystemCa({ ...process.env, ...env }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.add(child);
  child.stdout?.on("data", (chunk) => writeLog(`${label}: ${chunk}`));
  child.stderr?.on("data", (chunk) => writeLog(`${label}: ${chunk}`));
  child.once("error", (error) => writeLog(`${label}: ${error.stack || error}`));
  child.once("exit", (code, signal) => {
    children.delete(child);
    writeLog(`${label}: exited code=${code ?? ""} signal=${signal ?? ""}`);
  });
  return child;
}

async function waitForReady(url, timeoutMs = 240_000) {
  const startedAt = Date.now();
  let lastError = "runtime not ready";
  while (!shuttingDown && Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok !== false) return payload;
      lastError = payload.error || payload.code || `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`MEI runtime timeout: ${lastError}`);
}

function packagedPaths() {
  const runtimeRoot = process.env.MEI_RUNTIME_ROOT
    ? path.resolve(process.env.MEI_RUNTIME_ROOT)
    : path.join(process.resourcesPath, "runtime");
  return {
    runtimeRoot,
    voiceExe: path.join(runtimeRoot, "voice", "mei-voice", "mei-voice.exe"),
    sttExe: path.join(runtimeRoot, "stt", "mei-stt", "mei-stt.exe"),
    llamaExe: path.join(runtimeRoot, "llm", "launcher", "mei-llama-server.exe"),
    qwenModel: path.join(runtimeRoot, "models", "qwen", "qwen3-4b-instruct-2507-q4_k_m.gguf"),
    whisperSmall: path.join(runtimeRoot, "models", "faster-whisper-small"),
    whisperTiny: path.join(runtimeRoot, "models", "faster-whisper-tiny"),
    kokoroHome: path.join(runtimeRoot, "models", "kokoro"),
  };
}

function requirePackagedFile(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} missing: ${filePath}`);
}

async function startRuntime() {
  const [codecPort, voicePort, sttPort, llamaPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
  ]);
  const codecOrigin = `http://127.0.0.1:${codecPort}`;
  const voiceUrl = `http://127.0.0.1:${voicePort}`;
  const sttUrl = `http://127.0.0.1:${sttPort}`;
  let brainUrl = process.env.LM_STUDIO_URL || "http://127.0.0.1:1234/v1";
  let stagedRuntimeStartup = null;

  const commonEnv = {
    HF_HUB_DISABLE_XET: "1",
    HF_HUB_OFFLINE: "1",
    PYTHONNOUSERSITE: "1",
  };

  if (app.isPackaged || process.env.MEI_RUNTIME_ROOT) {
    const runtime = packagedPaths();
    for (const [filePath, label] of [
      [runtime.voiceExe, "Voice runtime"],
      [runtime.sttExe, "Transcription runtime"],
      [runtime.llamaExe, "Language runtime"],
      [runtime.qwenModel, "Qwen model"],
    ]) requirePackagedFile(filePath, label);

    brainUrl = `http://127.0.0.1:${llamaPort}/v1`;
    spawnService("voice", runtime.voiceExe, [], {
      ...commonEnv,
      HF_HOME: runtime.kokoroHome,
      MEI_VOICE_PORT: String(voicePort),
      MEI_KOKORO_VOICE: "if_sara",
    });
    const voiceWarmupStartedAt = Date.now();
    stagedRuntimeStartup = createStagedRuntimeStartup({
      waitForVoice: () => waitForReady(`${voiceUrl}/health`),
      launchDeferred: ({ voiceReady, reason }) => {
        const voiceWarmupMs = Date.now() - voiceWarmupStartedAt;
        writeLog(voiceReady
          ? `runtime: voice ready in ${voiceWarmupMs}ms; starting brain and hearing`
          : `runtime: voice unavailable after ${voiceWarmupMs}ms (${reason}); starting brain and hearing without it`);
        spawnService("stt", runtime.sttExe, [], {
          ...commonEnv,
          MEI_STT_PORT: String(sttPort),
          MEI_STT_MODEL: runtime.whisperSmall,
          MEI_WAKE_STT_MODEL: runtime.whisperTiny,
        });
        spawnService("brain", runtime.llamaExe, [
          "--model", runtime.qwenModel,
          "--alias", MODEL_ALIAS,
          "--host", "127.0.0.1",
          "--port", String(llamaPort),
          "--ctx-size", "4096",
          "--threads", String(Math.max(4, Math.min(12, require("node:os").availableParallelism() - 2))),
          "--jinja",
          "--n-gpu-layers", "0",
        ], {});
      },
      isCancelled: () => shuttingDown,
      voiceDeadlineMs: VOICE_FAIL_OPEN_MS,
      onError: (error) => {
        if (!shuttingDown) writeLog(`runtime: staged startup warning: ${error.message}`);
      },
    });
  } else {
    const voicePython = process.env.LOCAL_VOICE_PYTHON || "C:\\tmp\\mei-kokoro-env\\Scripts\\python.exe";
    const sttPython = process.env.LOCAL_STT_PYTHON || "C:\\tmp\\mei-stt-env\\Scripts\\python.exe";
    spawnService("voice-dev", voicePython, [path.join(PROJECT_ROOT, "local_voice.py")], {
      ...commonEnv,
      HF_HOME: process.env.HF_HOME || "C:\\tmp\\mei-kokoro-cache",
      MEI_VOICE_PORT: String(voicePort),
    });
    spawnService("stt-dev", sttPython, [path.join(PROJECT_ROOT, "local_stt.py")], {
      ...commonEnv,
      MEI_STT_PORT: String(sttPort),
      MEI_WAKE_STT_MODEL: process.env.MEI_WAKE_STT_MODEL || "C:\\tmp\\mei-stt-cache\\faster-whisper-tiny",
    });
  }

  const userData = app.getPath("userData");
  const dataDir = path.join(userData, "data");
  mkdirSync(dataDir, { recursive: true });
  const serverPath = path.join(app.getAppPath(), "server.mjs");
  spawnService("codec", process.execPath, [serverPath], {
    ELECTRON_RUN_AS_NODE: "1",
    HOST: "127.0.0.1",
    PORT: String(codecPort),
    LOCAL_TTS_URL: voiceUrl,
    LOCAL_STT_URL: sttUrl,
    LM_STUDIO_URL: brainUrl,
    LM_STUDIO_MODEL: MODEL_ALIAS,
    MEI_BACKGROUND_START_DELAY_MS: process.env.MEI_BACKGROUND_START_DELAY_MS || "90000",
    MEI_BRAIN_DB: path.join(dataDir, "mei-ling.sqlite"),
  });

  if (stagedRuntimeStartup) void stagedRuntimeStartup.start();
  const startedAt = Date.now();
  const runtimeWarmup = waitForReady(`${codecOrigin}/api/health`)
    .then(() => writeLog(`runtime: brain, voice and hearing ready in ${Date.now() - startedAt}ms`))
    .catch((error) => {
      if (!shuttingDown) writeLog(`runtime: background warmup failed: ${error.message}`);
    });
  await waitForHttpServer(codecOrigin);
  writeLog(
    `codec: interface ready in ${Date.now() - startedAt}ms; runtime continues warming in background`,
  );
  void runtimeWarmup;
  return codecOrigin;
}

function configurePermissions(codecOrigin) {
  const allowedOrigin = new URL(codecOrigin).origin;
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, origin) => (
    permission === "media" && origin === allowedOrigin
  ));
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    let allowed = false;
    try {
      allowed = permission === "media" && new URL(details.requestingUrl).origin === allowedOrigin;
    } catch {
      allowed = false;
    }
    callback(allowed);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 360,
    minHeight: 640,
    show: true,
    backgroundColor: "#020605",
    autoHideMenuBar: true,
    title: "MEI Codec",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "loading.html"));
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return mainWindow;
}

async function showRuntimeError(error) {
  writeLog(error.stack || error);
  const message = JSON.stringify(String(error.message || error));
  await mainWindow?.webContents.executeJavaScript(`window.showRuntimeError(${message})`).catch(() => {});
}

function stopRuntime() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // The process may already have exited.
    }
  }
  children.clear();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const logDir = path.join(app.getPath("userData"), "logs");
    mkdirSync(logDir, { recursive: true });
    runtimeLog = path.join(logDir, "runtime.log");
    createWindow();
    try {
      const codecOrigin = await startRuntime();
      configurePermissions(codecOrigin);
      await mainWindow.loadURL(`${codecOrigin}/?v=${APP_VERSION}&desktop=1`);
    } catch (error) {
      await showRuntimeError(error);
    }
  });
}

app.on("before-quit", stopRuntime);
app.on("window-all-closed", () => app.quit());
