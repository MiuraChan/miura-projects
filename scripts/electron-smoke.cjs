const path = require("node:path");
const { spawn } = require("node:child_process");
const electronPath = require("electron");

const child = spawn(electronPath, ["."], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, GRAYFOX_SMOKE_TEST: "1" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

let stdout = "";
let stderr = "";

child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

const timeout = setTimeout(() => {
  child.kill();
  process.stderr.write("Electron smoke test timed out.\n");
  process.exitCode = 1;
}, 30000);

child.on("exit", (code) => {
  clearTimeout(timeout);
  if (code !== 0 || !stdout.includes("GRAYFOX_SMOKE_OK")) {
    process.stderr.write(stderr || stdout || `Electron exited with code ${code}.\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(stdout);
});
