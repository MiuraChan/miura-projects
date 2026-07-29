import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const VOICE_PYTHON =
  process.env.LOCAL_VOICE_PYTHON ||
  "C:\\tmp\\mei-kokoro-env\\Scripts\\python.exe";
const STT_PYTHON =
  process.env.LOCAL_STT_PYTHON || "C:\\tmp\\mei-stt-env\\Scripts\\python.exe";

const voice = spawn(VOICE_PYTHON, ["local_voice.py"], {
  cwd: ROOT,
  env: {
    ...process.env,
    CUDA_VISIBLE_DEVICES: "",
    PYTHONNOUSERSITE: "1",
    HF_HOME: process.env.HF_HOME || "C:\\tmp\\mei-kokoro-cache",
    HF_HUB_DISABLE_XET: process.env.HF_HUB_DISABLE_XET || "1",
    HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE || "1",
  },
  stdio: "inherit",
  windowsHide: true,
});

const hearing = spawn(STT_PYTHON, ["local_stt.py"], {
  cwd: ROOT,
  env: {
    ...process.env,
    HF_HUB_DISABLE_XET: process.env.HF_HUB_DISABLE_XET || "1",
    HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE || "1",
  },
  stdio: "inherit",
  windowsHide: true,
});

const codec = spawn(process.execPath, ["server.mjs"], {
  cwd: ROOT,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

function stop() {
  if (!voice.killed) voice.kill();
  if (!hearing.killed) hearing.kill();
  if (!codec.killed) codec.kill();
}

voice.on("error", (error) => {
  console.error(`Local voice failed to start: ${error.message}`);
  stop();
  process.exitCode = 1;
});

hearing.on("error", (error) => {
  console.error(`Local transcription failed to start: ${error.message}`);
  stop();
  process.exitCode = 1;
});

codec.on("error", (error) => {
  console.error(`Codec server failed to start: ${error.message}`);
  stop();
  process.exitCode = 1;
});

voice.on("exit", (code) => {
  if (code && code !== 0) console.error(`Local voice exited with code ${code}`);
});

hearing.on("exit", (code) => {
  if (code && code !== 0) console.error(`Local transcription exited with code ${code}`);
});

codec.on("exit", (code) => {
  stop();
  process.exitCode = code || 0;
});

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
