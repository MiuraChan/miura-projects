import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGeminiInteraction,
  requestGeminiCompletion,
} from "./gemini-client.mjs";

test("buildGeminiInteraction separates instructions and keeps a stateless transcript", () => {
  const body = buildGeminiInteraction([
    { role: "system", content: "Sei Mei Ling." },
    { role: "user", content: "Ciao" },
    { role: "assistant", content: "Ciao, Miura." },
    { role: "user", content: "Dammi un'idea" },
  ], { model: "gemini-test", maxTokens: 120 });
  assert.equal(body.model, "gemini-test");
  assert.equal(body.system_instruction, "Sei Mei Ling.");
  assert.match(body.input, /UTENTE: Ciao/u);
  assert.match(body.input, /MEI LING: Ciao, Miura\./u);
  assert.equal(body.store, false);
  assert.equal(body.generation_config.max_output_tokens, 120);
});

test("requestGeminiCompletion keeps the key in a header and extracts output_text", async () => {
  let captured;
  const reply = await requestGeminiCompletion({
    apiKey: "secret-test-key",
    messages: [{ role: "user", content: "Ciao" }],
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ output_text: "Ci sono, Miura." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(reply, "Ci sono, Miura.");
  assert.equal(captured.options.headers["x-goog-api-key"], "secret-test-key");
  assert.doesNotMatch(captured.url, /secret-test-key/u);
  assert.equal(JSON.parse(captured.options.body).store, false);
});

test("requestGeminiCompletion reports free-tier quota exhaustion", async () => {
  await assert.rejects(
    requestGeminiCompletion({
      apiKey: "test",
      messages: [{ role: "user", content: "Ciao" }],
      fetchImpl: async () => new Response(
        JSON.stringify({ error: { message: "Quota exceeded" } }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    }),
    (error) => error.code === "GEMINI_QUOTA" && error.status === 429,
  );
});

