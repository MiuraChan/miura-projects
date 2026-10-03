import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import systemCa from "./desktop/system-ca.cjs";

const { withWindowsSystemCa } = systemCa;

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const VOICE_PYTHON =
  process.env.LOCAL_VOICE_PYTHON ||
  "C:\\tmp\\mei-kokoro-env\\Scripts\\python.exe";
const STT_PYTHON =
  process.env.LOCAL_STT_PYTHON || "C:\\tmp\\mei-stt-env\\Scripts\\python.exe";
const RESTART_BASE_DELAY_MS = 1_000;
const RESTART_MAX_DELAY_MS = 30_000;
const STABLE_UPTIME_MS = 60_000;
let shuttingDown = false;
let codec = null;

const services = [
  {
    label: "Local voice",
    command: VOICE_PYTHON,
    args: ["local_voice.py"],
    env: {
      ...process.env,
      CUDA_VISIBLE_DEVICES: "",
      PYTHONNOUSERSITE: "1",
      HF_HOME: process.env.HF_HOME || "C:\\tmp\\mei-kokoro-cache",
      HF_HUB_DISABLE_XET: process.env.HF_HUB_DISABLE_XET || "1",
      HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE || "1",
    },
    child: null,
    restartTimer: null,
    failures: 0,
  },
  {
    label: "Local transcription",
    command: STT_PYTHON,
    args: ["local_stt.py"],
    env: {
      ...process.env,
      HF_HUB_DISABLE_XET: process.env.HF_HUB_DISABLE_XET || "1",
      HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE || "1",
      MEI_WAKE_STT_MODEL:
        process.env.MEI_WAKE_STT_MODEL
        || "C:\\tmp\\mei-stt-cache\\faster-whisper-tiny",
    },
    child: null,
    restartTimer: null,
    failures: 0,
  },
];

function isRunning(child) {
  return child && child.exitCode === null && child.signalCode === null && !child.killed;
}

function stopChild(child) {
  if (isRunning(child)) child.kill();
}

function scheduleRestart(service, reason, startedAt) {
  if (shuttingDown || service.restartTimer) return;
  if (Date.now() - startedAt >= STABLE_UPTIME_MS) service.failures = 0;
  const exponent = Math.min(service.failures, 5);
  const delay = Math.min(
    RESTART_BASE_DELAY_MS * (2 ** exponent),
    RESTART_MAX_DELAY_MS,
  );
  service.failures = Math.min(service.failures + 1, 6);
  console.error(`${service.label} ${reason}; restarting in ${delay} ms`);
  service.restartTimer = setTimeout(() => {
    service.restartTimer = null;
    launchService(service);
  }, delay);
}

function launchService(service) {
  if (shuttingDown) return;
  const startedAt = Date.now();
  let handledExit = false;
  let spawned = false;
  const child = spawn(service.command, service.args, {
    cwd: ROOT,
    env: service.env,
    stdio: "inherit",
    windowsHide: true,
  });
  service.child = child;

  const handleUnexpectedExit = (reason) => {
    if (handledExit || shuttingDown) return;
    handledExit = true;
    if (service.child === child) service.child = null;
    scheduleRestart(service, reason, startedAt);
  };

  child.once("spawn", () => {
    spawned = true;
  });
  child.on("error", (error) => {
    if (!spawned) {
      handleUnexpectedExit(`failed to start: ${error.message}`);
      return;
    }
    console.error(`${service.label} process error: ${error.message}`);
  });
  child.once("exit", (code, signal) => {
    const reason = signal
      ? `exited after signal ${signal}`
      : `exited with code ${code ?? "unknown"}`;
    handleUnexpectedExit(reason);
  });
}

function stop(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  for (const service of services) {
    if (service.restartTimer) clearTimeout(service.restartTimer);
    service.restartTimer = null;
    stopChild(service.child);
    service.child = null;
  }
  stopChild(codec);
  codec = null;
}

for (const service of services) launchService(service);

codec = spawn(process.execPath, ["server.mjs"], {
  cwd: ROOT,
  env: withWindowsSystemCa(process.env),
  stdio: "inherit",
  windowsHide: true,
});
codec.once("error", (error) => {
  console.error(`Codec server failed to start: ${error.message}`);
  stop(1);
});
codec.once("exit", (code, signal) => {
  if (shuttingDown) return;
  if (signal) console.error(`Codec server exited after signal ${signal}`);
  stop(Number.isInteger(code) ? code : 1);
});

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
