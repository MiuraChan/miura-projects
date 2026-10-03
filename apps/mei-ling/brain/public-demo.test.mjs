import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openBrainDb } from "./db.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Public demo exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(800),
      });
      if (response.ok) return response.json();
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Public demo health timeout");
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

test("public demo is text-only, blocks private controls and stores no conversation", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "mei-public-demo-"));
  const database = path.join(temporary, "demo.sqlite");
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--no-warnings", "server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      MEI_PUBLIC_DEMO: "1",
      MEI_MODEL_PROVIDER: "gemini",
      GEMINI_API_KEY: "test-placeholder",
      MEI_BRAIN_DB: database,
      MEI_DISABLE_LIVE_SEARCH: "1",
      MEI_DISABLE_SCHEDULER: "1",
    },
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    const health = await waitForHealth(baseUrl, child);
    assert.equal(health.code, "READY");
    assert.equal(health.publicDemo, true);
    assert.equal(health.voice, "disabled");
    assert.equal(health.hearing, "disabled");

    const config = await (await fetch(`${baseUrl}/api/config`)).json();
    assert.equal(config.publicDemo, true);
    assert.equal(config.capabilities.textChat, true);
    assert.equal(config.capabilities.dailyIntel, false);
    assert.equal(config.capabilities.memory, false);
    assert.equal(config.capabilities.voice, false);
    assert.equal(config.capabilities.wakeWord, false);

    const replyResponse = await fetch(`${baseUrl}/api/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "public-test-session",
        message: "Ciao Mei Ling",
        inputMode: "text",
        clientVersion: "10",
        history: [],
      }),
    });
    assert.equal(replyResponse.status, 200);
    const reply = await replyResponse.json();
    assert.equal(reply.memory, "session-only");
    assert.ok(reply.reply);

    const instructions = await (await fetch(`${baseUrl}/api/instructions`)).json();
    assert.deepEqual(instructions.items, []);
    const forbidden = await fetch(`${baseUrl}/api/instructions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "persist this" }),
    });
    assert.equal(forbidden.status, 403);
  } finally {
    await stopChild(child);
  }

  const db = openBrainDb({ filename: database });
  try {
    assert.deepEqual(
      db.getConversationHistory({ conversationId: "miura-mei-ling-main-v10", limit: 20 }),
      [],
    );
  } finally {
    db.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

