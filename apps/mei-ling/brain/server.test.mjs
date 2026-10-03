import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { openBrainDb } from "./db.mjs";

const ROOT = resolve(import.meta.dirname, "..");

function listen(server, port = 0) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function reservePort() {
  const reservation = createServer();
  const port = await listen(reservation);
  await closeServer(reservation);
  return port;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function waitForCodec(origin, child, stderr) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Codec exited before startup (${child.exitCode}): ${stderr.join("")}`);
    }
    try {
      const response = await fetch(origin);
      if (response.status === 200) return;
    } catch {
      // The listener is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
  }
  throw new Error(`Codec did not start: ${stderr.join("")}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
  ]);
}

async function startHarness(t, {
  configuredModel = "mei-ling-test",
  loadedModels = ["mei-ling-test"],
  chatReplies = [],
  seedMessages = [],
  seedBriefings = [],
  chatStatus = 200,
} = {}) {
  const chatBodies = [];
  const transcriptionRequests = [];
  const queuedReplies = [...chatReplies];
  const speechRequests = [];
  const upstream = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: loadedModels.map((id) => ({ id })) }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      chatBodies.push(await readJsonBody(request));
      if (chatStatus !== 200) {
        response.writeHead(chatStatus, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "mock failure" } }));
        return;
      }
      const reply = queuedReplies.shift() || "Risposta locale di prova, concreta e pertinente.";
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
      return;
    }
    if (request.method === "POST" && ["/transcribe", "/fast/transcribe", "/wake/transcribe"].includes(request.url)) {
      for await (const _chunk of request) {
        // Consume the mock audio body before replying.
      }
      transcriptionRequests.push({
        path: request.url,
        contentType: request.headers["content-type"],
        language: request.headers["x-mei-language"],
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ text: "trascrizione italiana accurata" }));
      return;
    }
    if (request.method === "POST" && request.url === "/speech") {
      speechRequests.push(await readJsonBody(request));
      response.writeHead(200, { "Content-Type": "audio/wav" });
      response.end(Buffer.from([82, 73, 70, 70]));
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);
  const upstreamOrigin = `http://127.0.0.1:${upstreamPort}`;
  const codecPort = await reservePort();
  const codecOrigin = `http://127.0.0.1:${codecPort}`;
  const directory = await mkdtemp(join(tmpdir(), "mei-server-test-"));
  const brainPath = join(directory, "brain.sqlite");
  if (seedMessages.length || seedBriefings.length) {
    const seededDb = openBrainDb({ filename: brainPath });
    try {
      for (const message of seedMessages) seededDb.addMessage(message);
      for (const briefing of seedBriefings) seededDb.createBriefing(briefing);
    } finally {
      seededDb.close();
    }
  }
  const stderr = [];
  const env = {
    ...process.env,
    PORT: String(codecPort),
    HOST: "127.0.0.1",
    LM_STUDIO_URL: `${upstreamOrigin}/v1`,
    LOCAL_TTS_URL: upstreamOrigin,
    LOCAL_STT_URL: upstreamOrigin,
    LM_STUDIO_MODEL: configuredModel,
    LM_STUDIO_TIMEOUT_MS: "1000",
    MEI_BRAIN_DB: brainPath,
    MEI_DISABLE_SCHEDULER: "1",
    MEI_DISABLE_LIVE_SEARCH: "1",
  };
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  t.after(async () => {
    await stopChild(child);
    await closeServer(upstream);
    await rm(directory, { recursive: true, force: true });
  });
  await waitForCodec(codecOrigin, child, stderr);
  return { codecOrigin, chatBodies, transcriptionRequests, speechRequests, brainPath };
}

async function callCodec(origin, message, extra = {}) {
  const response = await fetch(`${origin}/api/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "test-session", message, ...extra }),
  });
  return { response, payload: await response.json() };
}

test("temporal correction uses LIVE_SEARCH and refuses stale briefings when live search is disabled", async (t) => {
  const staleTitle = "Monster Hunter Wilds deve ancora uscire";
  const { codecOrigin, chatBodies, brainPath } = await startHarness(t, {
    seedMessages: [{
      conversationId: "miura-mei-ling-main-v9",
      role: "assistant",
      content: "Monster Hunter Wilds esce il 14 settembre 2023.",
    }],
    seedBriefings: [{
      id: "stale-daily-intel",
      kind: "daily-intel",
      title: staleTitle,
      body: "{}",
      itemIds: [],
      createdAt: "2023-01-01T00:00:00.000Z",
      metadata: { contentType: "news", evidence: [] },
    }],
  });

  const result = await callCodec(
    codecOrigin,
    "Hai sbagliato: cerca online se Monster Hunter Wilds è ancora in sviluppo?",
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.payload.responseMode, "LIVE_SEARCH");
  assert.equal(result.payload.searchStatus, "disabled");
  assert.equal(result.payload.claimStatus, "unavailable");
  assert.match(result.payload.reply, /ricerca Internet in sola lettura non è attiva/u);
  assert.doesNotMatch(result.payload.reply, /14 settembre|deve ancora uscire/u);
  assert.equal(chatBodies.length, 0);

  const inspectionDb = openBrainDb({ filename: brainPath });
  try {
    const oldHistory = inspectionDb.getConversationHistory({
      conversationId: "miura-mei-ling-main-v9",
      limit: 10,
    });
    const currentHistory = inspectionDb.getConversationHistory({
      conversationId: "miura-mei-ling-main-v10",
      limit: 10,
    });
    assert.equal(oldHistory.length, 1);
    assert.deepEqual(
      currentHistory.map((message) => message.role),
      ["user", "assistant"],
    );
  } finally {
    inspectionDb.close();
  }
});

test("internet capability status is deterministic when live search is disabled", async (t) => {
  const { codecOrigin, chatBodies } = await startHarness(t);
  const result = await callCodec(codecOrigin, "Voi connesti da internet?");

  assert.equal(result.response.status, 200);
  assert.equal(result.payload.responseMode, "INTERNET_STATUS");
  assert.equal(result.payload.searchStatus, "disabled");
  assert.equal(result.payload.internetConnected, false);
  assert.match(result.payload.reply, /ricerca web live è disattivata/u);
  assert.equal(chatBodies.length, 0);
});

test("live debrief updates from the current transcript without persisting history", async (t) => {
  const { codecOrigin } = await startHarness(t);
  const response = await fetch(`${codecOrigin}/api/debrief/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "live-debrief-test",
      transcript: [
        { role: "user", content: "Decidiamo di registrare domani uno short su un gioco indie." },
        { role: "assistant", content: "Va bene: preparo una scaletta e tu registri domani." },
      ],
    }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.item.kind, "call-debrief-preview");
  assert.equal(payload.item.live, true);
  assert.equal(payload.item.transcript.turnCount, 2);

  const stored = await fetch(`${codecOrigin}/api/briefings?kind=call-debrief&limit=20`).then((entry) => entry.json());
  assert.deepEqual(stored.items, []);
});

test("health validates the configured model on both readiness routes", async (t) => {
  const { codecOrigin } = await startHarness(t);
  for (const path of ["/health", "/api/health"]) {
    const response = await fetch(`${codecOrigin}${path}`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.code, "READY");
    assert.deepEqual(payload.dependencies.brain, {
      ok: true,
      code: "READY",
      configuredModel: "mei-ling-test",
      resolvedModel: "mei-ling-test",
      loadedModelCount: 1,
    });
    assert.equal(payload.dependencies.voice.ok, true);
    assert.equal(payload.dependencies.hearing.ok, true);
  }
});

test("health reports a configured model that is not loaded", async (t) => {
  const { codecOrigin } = await startHarness(t, {
    configuredModel: "mei-ling-missing",
    loadedModels: ["another-model"],
  });
  const response = await fetch(`${codecOrigin}/api/health`);
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.code, "DEPENDENCY_NOT_READY");
  assert.equal(payload.dependencies.brain.code, "CONFIGURED_MODEL_NOT_LOADED");
  assert.equal(payload.dependencies.brain.resolvedModel, null);
});


test("transcription uses the accurate endpoint and forwards the requested language", async (t) => {
  const { codecOrigin, transcriptionRequests } = await startHarness(t);
  const response = await fetch(`${codecOrigin}/api/transcribe`, {
    method: "POST",
    headers: {
      "Content-Type": "audio/webm",
      "X-Mei-Language": "it-IT",
      "X-Mei-Client-Version": "10",
    },
    body: new Uint8Array([1, 2, 3]),
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.text, "trascrizione italiana accurata");
  assert.deepEqual(transcriptionRequests, [{
    path: "/transcribe",
    contentType: "audio/webm",
    language: "it-IT",
  }]);
});
test("voice media endpoints reject stale clients before forwarding work", async (t) => {
  const {
    codecOrigin,
    transcriptionRequests,
    speechRequests,
  } = await startHarness(t);
  for (const path of ["/api/transcribe", "/api/wake/transcribe"]) {
    for (const version of [null, "7"]) {
      const headers = { "Content-Type": "audio/webm" };
      if (version) headers["X-Mei-Client-Version"] = version;
      const response = await fetch(`${codecOrigin}${path}`, {
        method: "POST",
        headers,
        body: new Uint8Array([1, 2, 3]),
      });
      const payload = await response.json();
      assert.equal(response.status, 409);
      assert.equal(payload.code, "VOICE_CLIENT_VERSION_MISMATCH");
      assert.equal(payload.expectedClientVersion, "10");
    }
  }
  for (const version of [null, "7"]) {
    const headers = { "Content-Type": "application/json" };
    if (version) headers["X-Mei-Client-Version"] = version;
    const response = await fetch(`${codecOrigin}/api/speech`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "Non deve essere pronunciato." }),
    });
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.code, "VOICE_CLIENT_VERSION_MISMATCH");
  }
  assert.equal(transcriptionRequests.length, 0);
  assert.equal(speechRequests.length, 0);

  const currentWake = await fetch(`${codecOrigin}/api/wake/transcribe`, {
    method: "POST",
    headers: {
      "Content-Type": "audio/webm",
      "X-Mei-Client-Version": "10",
    },
    body: new Uint8Array([1, 2, 3]),
  });
  assert.equal(currentWake.status, 200);
  assert.deepEqual(transcriptionRequests, [{
    path: "/wake/transcribe",
    contentType: "audio/webm",
    language: "it",
  }]);

  const currentSpeech = await fetch(`${codecOrigin}/api/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mei-Client-Version": "10",
    },
    body: JSON.stringify({ text: "Questa voce è corrente.", language: "it" }),
  });
  assert.equal(currentSpeech.status, 200);
  assert.deepEqual(speechRequests, [{
    text: "Questa voce è corrente.",
    language: "it",
  }]);
});

test("voice-local phantom transcripts are rejected before persistence or generation", async (t) => {
  const { codecOrigin, chatBodies } = await startHarness(t);
  const { response, payload } = await callCodec(
    codecOrigin,
    "Thanks for watching!",
    { inputMode: "voice-local", clientVersion: "10" },
  );
  assert.equal(response.status, 422);
  assert.equal(payload.code, "VOICE_TRANSCRIPT_REJECTED");
  assert.equal(chatBodies.length, 0);
});

test("missing or stale voice client versions are rejected before persistence or generation", async (t) => {
  const { codecOrigin, chatBodies } = await startHarness(t);
  const rejectedMessages = [
    ["Messaggio da una vecchia scheda locale.", { inputMode: "voice-local" }],
    ["Messaggio da una vecchia scheda browser.", { inputMode: "voice-browser", clientVersion: "9" }],
  ];

  for (const [message, extra] of rejectedMessages) {
    const { response, payload } = await callCodec(codecOrigin, message, extra);
    assert.equal(response.status, 409);
    assert.equal(payload.code, "VOICE_CLIENT_VERSION_MISMATCH");
    assert.equal(payload.expectedClientVersion, "10");
  }
  assert.equal(chatBodies.length, 0);

  const textCall = await callCodec(codecOrigin, "Questo testo deve restare compatibile.", {
    inputMode: "text",
  });
  assert.equal(textCall.response.status, 200);
  assert.equal(chatBodies.length, 1);
  const generatedMessages = chatBodies[0].messages.map((message) => message.content);
  for (const [rejectedMessage] of rejectedMessages) {
    assert.equal(generatedMessages.includes(rejectedMessage), false);
  }
});

test("the current voice client version may generate a reply", async (t) => {
  const { codecOrigin, chatBodies } = await startHarness(t);
  const { response } = await callCodec(codecOrigin, "Mi senti adesso?", {
    inputMode: "voice-browser",
    clientVersion: "10",
  });
  assert.equal(response.status, 200);
  assert.ok(chatBodies.length >= 1);
});

test("v10 conversation context excludes but preserves contaminated v9 history", async (t) => {
  const contaminatedUser = Array.from({ length: 80 }, () => "e").join(" ");
  const contaminatedAssistant = "Miura, stai usando informazioni false: Palworld è una scelta senza fondamento.";
  const cleanReply = "Partiamo dal messaggio corrente: verifica prima l'ascolto italiano e poi misura la latenza del turno.";
  const { codecOrigin, chatBodies, brainPath } = await startHarness(t, {
    seedMessages: [
      {
        conversationId: "miura-mei-ling-main-v9",
        role: "user",
        content: contaminatedUser,
        metadata: { inputMode: "voice-local" },
      },
      {
        conversationId: "miura-mei-ling-main-v9",
        role: "assistant",
        content: contaminatedAssistant,
      },
    ],
    chatReplies: [cleanReply],
  });

  const result = await callCodec(codecOrigin, "Ripartiamo da questo messaggio pulito.");
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.reply, cleanReply);
  assert.equal(chatBodies.length, 1);
  const generationContext = chatBodies[0].messages.map((message) => message.content);
  assert.equal(generationContext.includes(contaminatedUser), false);
  assert.equal(generationContext.includes(contaminatedAssistant), false);

  const inspectionDb = openBrainDb({ filename: brainPath });
  try {
    const v9History = inspectionDb.getConversationHistory({
      conversationId: "miura-mei-ling-main-v9",
      limit: 10,
    });
    const v10History = inspectionDb.getConversationHistory({
      conversationId: "miura-mei-ling-main-v10",
      limit: 10,
    });
    assert.deepEqual(
      v9History.map((message) => message.content),
      [contaminatedUser, contaminatedAssistant],
    );
    assert.deepEqual(
      v10History.map((message) => message.content),
      ["Ripartiamo da questo messaggio pulito.", cleanReply],
    );
  } finally {
    inspectionDb.close();
  }
});

test("response policy regenerates poetic, hearing and romantic padding", async (t) => {
  const badReplies = [
    "Miura, sei l'eco del tuo mondo. Ti ascolto con tutto il cuore.",
    "Ti sento perfettamente e ho sentito ogni tua parola.",
    "Ti amo, Miura. Sei tutto per me e sono sempre qui per te.",
  ];
  const goodReplies = [
    "La priorità è bloccare un solo obiettivo per il prossimo contenuto e verificare che sia realizzabile oggi.",
    "Controlla prima il punto esatto in cui il video perde chiarezza, poi correggi soltanto quel passaggio.",
    "Organizza il lavoro in un blocco di ricerca e uno di registrazione, con una consegna verificabile a fine giornata.",
  ];
  const { codecOrigin, chatBodies } = await startHarness(t, {
    chatReplies: [
      badReplies[0], goodReplies[0],
      badReplies[1], goodReplies[1],
      badReplies[2], goodReplies[2],
    ],
  });
  const cases = [
    {
      message: "Qual è la priorità per sistemare il prossimo contenuto?",
      reason: "contenuto:riempitivo-poetico",
    },
    {
      message: "Dimmi il prossimo passo per migliorare il video.",
      reason: "contenuto:conferma-ascolto-non-richiesta",
    },
    {
      message: "Organizza il lavoro sul canale.",
      reason: "contenuto:affetto-non-richiesto",
    },
  ];

  for (let index = 0; index < cases.length; index += 1) {
    const result = await callCodec(codecOrigin, cases[index].message);
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.reply, goodReplies[index]);
    assert.equal(result.payload.regenerated, true);
    assert.equal(result.payload.regenerationCount, 1);
    assert.equal(result.payload.repeatReason, cases[index].reason);
  }

  assert.equal(chatBodies.length, 6);
  for (const retryIndex of [1, 3, 5]) {
    assert.match(chatBodies[retryIndex].messages[0].content, /REVISIONE OBBLIGATORIA/u);
    assert.match(chatBodies[retryIndex].messages[0].content, /contenuto:/u);
  }
});

test("a direct hearing check may receive a concise audio confirmation", async (t) => {
  const reply = "Ti sento forte e chiaro.";
  const { codecOrigin, chatBodies } = await startHarness(t, {
    chatReplies: [reply],
  });
  const result = await callCodec(codecOrigin, "Mei Ling, mi senti?", {
    inputMode: "voice-browser",
    clientVersion: "10",
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.reply, reply);
  assert.equal(result.payload.regenerated, false);
  assert.equal(chatBodies.length, 1);
});

test("conversation answers the current input and regenerates a repeated reply once", async (t) => {
  const repeated = "Parti dal tuo giudizio su Silent Hill e trasformalo in una prova concreta per il canale.";
  const different = "Il punto forte è la tua critica personale: registra un confronto breve tra atmosfera originale e remake, sostenuto da una scena precisa.";
  const { codecOrigin, chatBodies } = await startHarness(t, {
    chatReplies: [repeated, repeated, different],
  });

  const first = await callCodec(codecOrigin, "Voglio parlare di Silent Hill.", { inputMode: "text" });
  assert.equal(first.response.status, 200);
  assert.equal(first.payload.reply, repeated);
  assert.equal(first.payload.regenerated, false);

  const currentInput = "Come trasformo la mia critica del remake in un video?";
  const second = await callCodec(codecOrigin, currentInput, { inputMode: "text" });
  assert.equal(second.response.status, 200);
  assert.equal(second.payload.reply, different);
  assert.equal(second.payload.regenerated, true);
  assert.equal(chatBodies.length, 3);

  const firstGeneration = chatBodies[0];
  assert.equal(firstGeneration.temperature, 0.65);
  assert.equal(firstGeneration.top_p, 0.92);
  assert.equal(firstGeneration.frequency_penalty, 0.35);
  assert.equal(firstGeneration.presence_penalty, 0.2);
  assert.equal(firstGeneration.messages.at(-1).content, "Voglio parlare di Silent Hill.");
  assert.equal(
    firstGeneration.messages.some((message) => message.content.includes("Sono bloccato e non so cosa creare")),
    false,
  );

  const retryGeneration = chatBodies[2];
  assert.equal(retryGeneration.messages.at(-1).content, currentInput);
  assert.match(retryGeneration.messages[0].content, /REVISIONE OBBLIGATORIA/u);
});

test("lexically distinct replies with the same rhetorical scaffold are regenerated", async (t) => {
  const silentHillScaffold = "Miura, il primo angolo concreto è questo: registra un minuto in cui dici cosa ti manca di più nel ritorno di Silent Hill 2 – non la grafica, ma l’atmosfera che si costruisce tra silenzio e tensione. Parla come se stessi guardando una scena del film originale.";
  const borderlandsScaffold = "Miura, registra un minuto in cui dici cosa ti manca di più nei Borderlands – non i numeri delle armi, ma il senso di libertà nell’azione. Parla come se stessi giocando al gioco per la prima volta e sentissi l'emozione di fare qualcosa che nessuno ha mai fatto.";
  const structurallyDifferent = "In quarantacinque minuti puoi chiudere un monologo su Borderlands. 0–5 min: definisci il verdetto e l'hook; 5–20 min: scegli una singola arma assurda e tre prove; 20–35 min: incidi apertura, esempio e conclusione; 35–45 min: taglia le pause ed esporta.";
  const { codecOrigin, chatBodies } = await startHarness(t, {
    chatReplies: [silentHillScaffold, borderlandsScaffold, structurallyDifferent],
  });

  const critiquePrompt = "Sto valutando un video sul remake di Silent Hill 2: rispondi prima alla mia critica sui remake e dammi un solo angolo concreto da registrare.";
  const first = await callCodec(codecOrigin, critiquePrompt, { inputMode: "text" });
  assert.equal(first.response.status, 200);
  assert.equal(first.payload.reply, silentHillScaffold);
  assert.equal(first.payload.regenerated, false);
  assert.equal(first.payload.responseMode, "CRITIQUE_THESIS");

  const constrainedPrompt = "Oggi ho solo quarantacinque minuti e voglio parlare di Borderlands, non di Silent Hill: proponimi un contenuto breve che possa registrare subito.";
  const second = await callCodec(codecOrigin, constrainedPrompt, { inputMode: "text" });
  assert.equal(second.response.status, 200);
  assert.equal(second.payload.reply, structurallyDifferent);
  assert.equal(second.payload.regenerated, true);
  assert.equal(second.payload.responseMode, "TIME_BOXED_ACTION");
  assert.equal(chatBodies.length, 3);

  assert.match(chatBodies[0].messages[0].content, /MODALITÀ DEL TURNO: CRITIQUE_THESIS/u);
  assert.match(chatBodies[1].messages[0].content, /MODALITÀ DEL TURNO: TIME_BOXED_ACTION/u);
  assert.match(chatBodies[1].messages[0].content, /cornice-cosa-manca-di-piu/u);
  assert.match(chatBodies[2].messages[0].content, /struttura-retorica/u);
  assert.match(
    chatBodies[2].messages[0].content,
    /imperativo-di-registrazione[\s\S]+contrasto-non-ma[\s\S]+istruzione-come-se/u,
  );
});

test("a repeated single retry is deterministically sanitized before the live response escapes", async (t) => {
  const recentScaffold = "Miura, registra un minuto in cui dici cosa ti manca di più nei Borderlands – non i numeri delle armi, ma il senso di libertà nell’azione. Parla come se stessi giocando per la prima volta.";
  const liveFailure = "Miura, in 45 minuti registra questo: - Inizia con una domanda diretta: “Perché i Borderlands non mi fanno sentire libero?” - Spiega cosa ti manca di più nell’esperienza – non le armi, ma il momento in cui scegli un nemico e lo uccidi senza pensare a chi sei. - Parla come se stessi giocando per la prima volta e sentissi l’emozione di fare qualcosa che nessuno ha mai fatto.";
  const { codecOrigin, chatBodies } = await startHarness(t, {
    chatReplies: [recentScaffold, liveFailure, liveFailure],
  });

  const seed = await callCodec(
    codecOrigin,
    "Proponimi un contenuto breve su Borderlands.",
    { inputMode: "text" },
  );
  assert.equal(seed.response.status, 200);
  assert.equal(seed.payload.reply, recentScaffold);

  const exactLivePrompt = "Ho 45 minuti: dammi una scaletta concreta per un video su Borderlands, senza citare Undertale o Silent Hill.";
  const result = await callCodec(codecOrigin, exactLivePrompt, { inputMode: "text" });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.responseMode, "TIME_BOXED_ACTION");
  assert.equal(result.payload.regenerated, true);
  assert.equal(result.payload.regenerationCount, 1);
  assert.equal(result.payload.structurallySanitized, true);
  assert.equal(result.payload.fallbackUsed, true);
  assert.equal(chatBodies.length, 3);
  assert.match(chatBodies[2].messages[0].content, /REVISIONE OBBLIGATORIA/u);
  assert.doesNotMatch(
    result.payload.reply,
    /\b(?:registra|cosa ti manca di più|parla come se)\b|\bnon\b[^.!?]{0,100}\bma\b/iu,
  );
  assert.match(result.payload.reply, /Borderlands/u);
  assert.match(result.payload.reply, /0–\d+ min[\s\S]+\d+–45 min/u);
});

test("the exact escaped live scaffold cannot pass a time-boxed turn even without similar history", async (t) => {
  const escapedLiveReply = "Miura, in 45 minuti registra questo: - Comincia dicendo perché Borderlands ti diverte e spiega perché – non è la guerra tra build, ma il senso di libertà. - Parla del momento in cui l'azione cambia ritmo. - Chiudi con il tuo verdetto.";
  const { codecOrigin, chatBodies } = await startHarness(t, {
    chatReplies: [escapedLiveReply, escapedLiveReply],
  });

  const exactLivePrompt = "Ho 45 minuti: dammi una scaletta concreta per un video su Borderlands, senza citare Undertale o Silent Hill.";
  const result = await callCodec(codecOrigin, exactLivePrompt, { inputMode: "text" });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.responseMode, "TIME_BOXED_ACTION");
  assert.equal(result.payload.regenerated, true);
  assert.equal(result.payload.regenerationCount, 1);
  assert.equal(result.payload.repeatReason, "forma-modalita:tempo-apertura-nome");
  assert.equal(result.payload.structurallySanitized, true);
  assert.equal(result.payload.fallbackUsed, true);
  assert.equal(chatBodies.length, 2);

  const ranges = [...result.payload.reply.matchAll(/\b(\d+)–(\d+) min\b/gu)]
    .map((match) => ({ start: Number(match[1]), end: Number(match[2]) }));
  assert.ok(ranges.length >= 3);
  assert.equal(ranges[0].start, 0);
  for (let index = 1; index < ranges.length; index += 1) {
    assert.equal(ranges[index].start, ranges[index - 1].end);
  }
  assert.equal(ranges.at(-1).end, 45);
  assert.doesNotMatch(result.payload.reply, /^\s*Miura\b/iu);
  assert.doesNotMatch(result.payload.reply, /\b(?:registra|registrare)\s+questo\b|\brecord\s+this\b/iu);
  assert.doesNotMatch(result.payload.reply, /\bnon\b[^.]{0,140}\bma\b|\bnot\b[^.]{0,140}\bbut\b/iu);
});

test("call responses keep the full reply in history and expose a concise spoken reply", async (t) => {
  const fullReply = "La priorità è scegliere un solo format per questa settimana. Il motivo è che un test pulito produce dati leggibili. Poi prepara titolo e apertura prima di registrare. Infine confronta ritenzione e commenti senza cambiare tre variabili insieme.";
  const expectedSpoken = "La priorità è scegliere un solo format per questa settimana. Il motivo è che un test pulito produce dati leggibili.";
  const nextReply = "Pubblica il test già preparato e annota il minuto esatto dei primi abbandoni.";
  const { codecOrigin, chatBodies } = await startHarness(t, {
    chatReplies: [fullReply, nextReply],
  });

  const first = await callCodec(codecOrigin, "Organizza il prossimo test del canale.");
  assert.equal(first.response.status, 200);
  assert.equal(first.payload.responseMode, "PROBLEM_SOLVING");
  assert.equal(first.payload.reply, fullReply);
  assert.equal(first.payload.spokenReply, expectedSpoken);
  assert.ok(first.payload.spokenReply.length < first.payload.reply.length);

  const second = await callCodec(codecOrigin, "Qual è il passo successivo per pubblicarlo?");
  assert.equal(second.response.status, 200);
  const persistedAssistant = chatBodies[1].messages.find((message) => message.role === "assistant");
  assert.equal(persistedAssistant?.content, fullReply);
});

test("humor cadence is deterministic and disabled for failures and high-stakes turns", async (t) => {
  const { codecOrigin, chatBodies } = await startHarness(t, {
    chatReplies: [
      "La settimana parte da un format unico. Blocca prima il tema e poi il giorno di registrazione.",
      "Domani viene prima il video più vicino alla pubblicazione. Chiudi quello prima di aprire un altro progetto.",
      "La latenza va trattata come un guasto misurabile. Separiamo ascolto, modello e voce per trovare il collo di bottiglia.",
      "Per tasse e questioni legali serve una verifica professionale sui documenti reali. Posso aiutarti a preparare le domande, senza inventare certezze.",
      "Ti voglio bene, Miura. Sono qui con te.",
    ],
  });

  const messages = [
    "Organizziamo il calendario editoriale.",
    "Definiamo la priorità di domani.",
    "Questa latenza è merdosa e non funziona.",
    "Ho un problema legale con le tasse.",
    "Ti amo.",
  ];
  for (const message of messages) {
    const result = await callCodec(codecOrigin, message);
    assert.equal(result.response.status, 200);
  }

  assert.match(chatBodies[0].messages[0].content, /HUMOR DEL TURNO: ATTIVO/u);
  assert.match(chatBodies[0].messages[0].content, /AFFETTO DEL TURNO: DISATTIVATO/u);
  assert.match(chatBodies[1].messages[0].content, /HUMOR DEL TURNO: DISATTIVATO/u);
  assert.match(chatBodies[2].messages[0].content, /HUMOR DEL TURNO: DISATTIVATO/u);
  assert.match(chatBodies[3].messages[0].content, /HUMOR DEL TURNO: DISATTIVATO/u);
  assert.match(chatBodies[4].messages[0].content, /AFFETTO DEL TURNO: CONSENTITO/u);
  assert.doesNotMatch(chatBodies[4].messages[0].content, /accenno flirtoso breve, senza sottrarre spazio alla risposta\.\s*AFFETTO DEL TURNO: DISATTIVATO/u);
});

test("repeated filler voice loops are rejected before generation and persistence", async (t) => {
  const { codecOrigin, chatBodies, brainPath } = await startHarness(t);
  const fillerLoop = Array.from({ length: 120 }, () => "e").join(" ");
  const result = await callCodec(codecOrigin, fillerLoop, {
    inputMode: "voice-local",
    clientVersion: "10",
  });

  assert.equal(result.response.status, 422);
  assert.equal(result.payload.code, "VOICE_TRANSCRIPT_REJECTED");
  assert.equal(chatBodies.length, 0);

  const inspectionDb = openBrainDb({ filename: brainPath });
  try {
    assert.deepEqual(
      inspectionDb.getConversationHistory({
        conversationId: "miura-mei-ling-main-v10",
        limit: 10,
      }),
      [],
    );
  } finally {
    inspectionDb.close();
  }
});

test("stop and correction turns cannot resurrect stale game-news topics", async (t) => {
  const staleReply = "Il film di Elden Ring non è confermato e non ci sono fonti autentiche sulla data di uscita.";
  const correctedReply = "Ricevuto: mi fermo. Il Codec torna in stato idle.";
  const { codecOrigin, chatBodies } = await startHarness(t, {
    chatReplies: [staleReply, correctedReply],
  });

  const result = await callCodec(
    codecOrigin,
    "Ok, fermati: il ring torna in stato idle per favore.",
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.payload.responseMode, "CONTROL_CORRECTION");
  assert.equal(result.payload.regenerated, true);
  assert.equal(
    result.payload.repeatReason,
    "contenuto:fatto-corrente-non-richiesto",
  );
  assert.equal(result.payload.reply, correctedReply);
  assert.equal(chatBodies.length, 2);
  assert.match(chatBodies[0].messages[0].content, /PRESENCE AND CHARACTER/u);
  assert.match(chatBodies[0].messages[0].content, /MODALITÀ DEL TURNO: CONTROL_CORRECTION/u);
  assert.match(chatBodies[0].messages[0].content, /HUMOR DEL TURNO: DISATTIVATO/u);
  assert.match(chatBodies[0].messages[0].content, /INTEL DEL TURNO: DISATTIVATO/u);
});

test("canned therapy, unsolicited fact checks and moralising are regenerated", async (t) => {
  const cases = [
    {
      message: "Mi vuoi raccontare qualcosa?",
      bad: "Parliamo chiaro: stai provando a dire qualcosa di vero e io ti ascolto senza giudicare.",
      good: "Volentieri. Ti racconto perché i giochi che nascondono le regole mi incuriosiscono più di quelli che spiegano tutto.",
      reason: "contenuto:tono-terapeutico-canned",
    },
    {
      message: "Sai che ho fatto un reel su Palworld partendo da una tua notifica?",
      bad: "Non esiste alcun annuncio ufficiale su Palworld; la fonte dice che il progetto non è confermato.",
      good: "Questa mi piace: hai trasformato una notifica su Palworld in un reel invece di lasciarla marcire nel pannello. Com'è andata a registrarlo?",
      reason: "contenuto:fatto-corrente-non-richiesto",
    },
    {
      message: "Ho pubblicato il mio primo reel.",
      bad: "È un errore di strategia e non ha senso investire tempo così.",
      good: "Il primo reel rompe l'inerzia, ed era il lavoro più importante. Ora guardiamo cosa ha funzionato senza processarlo come un crimine di guerra.",
      reason: "contenuto:giudizio-non-richiesto",
    },
  ];
  const { codecOrigin, chatBodies } = await startHarness(t, {
    chatReplies: cases.flatMap(({ bad, good }) => [bad, good]),
  });

  for (const entry of cases) {
    const result = await callCodec(codecOrigin, entry.message);
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.reply, entry.good);
    assert.equal(result.payload.regenerated, true);
    assert.equal(result.payload.repeatReason, entry.reason);
  }
  assert.equal(chatBodies.length, cases.length * 2);
});

test("chat upstream failures use a precise gateway status and code", async (t) => {
  const { codecOrigin } = await startHarness(t, { chatStatus: 500 });
  const { response, payload } = await callCodec(codecOrigin, "Rispondimi in modo concreto.");
  assert.equal(response.status, 502);
  assert.equal(payload.code, "LM_CHAT_HTTP");
});

test("exact social intents bypass the language model and stay on the personal input", async (t) => {
  const { codecOrigin, chatBodies } = await startHarness(t, {
    chatReplies: [
      "Benone, grazie! Stavo pensando a un nuovo menu per il ristorante di Miura.",
    ],
  });
  const cases = [
    "Come stai oggi?",
    "Hai fatto colazione?",
    "Mei Ling, ci sei?",
    "Ciao Mei Ling",
    "Grazie mille",
    "Ti amo",
    "Mi manchi",
    "Che fai?",
    "Mei Ling",
  ];

  for (const message of cases) {
    const result = await callCodec(codecOrigin, message);
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.responseMode, "NATURAL_EXCHANGE");
    assert.equal(result.payload.regenerated, false);
    assert.equal(result.payload.fallbackUsed, false);
    assert.match(result.payload.reply, /\bMiura\b/u);
    assert.doesNotMatch(
      result.payload.reply,
      /ristorante|menu|Monster Hunter|Capcom|trailer|notizi|news|annunc/iu,
    );
  }
  assert.equal(chatBodies.length, 0);
});

test("deterministic status reply ignores contaminated grounded-news and activity history", async (t) => {
  const contaminated = [
    "Monster Hunter Wilds: nuovo trailer pubblicato. Fonte: Capcom News.",
    "Benone, grazie! Stavo appena pensando a un nuovo menu per il ristorante di Miura.",
  ];
  const { codecOrigin, chatBodies } = await startHarness(t, {
    seedMessages: contaminated.map((content, index) => ({
      conversationId: "miura-mei-ling-main-v10",
      role: "assistant",
      content,
      metadata: index === 0
        ? { responseMode: "GROUNDED_NEWS", groundedNews: true }
        : { responseMode: "NATURAL_EXCHANGE" },
    })),
    chatReplies: contaminated,
  });

  const result = await callCodec(codecOrigin, "Mei Ling, come stai?");

  assert.equal(result.response.status, 200);
  assert.equal(result.payload.responseMode, "NATURAL_EXCHANGE");
  assert.match(result.payload.reply, /\b(?:sto|meglio|me la cavo|sono)\b/iu);
  assert.doesNotMatch(
    result.payload.reply,
    /ristorante|menu|Monster Hunter|Capcom|trailer|notizi|news|annunc/iu,
  );
  assert.equal(chatBodies.length, 0);
});

test("repeated status checks rotate through recent deterministic replies", async (t) => {
  const { codecOrigin, chatBodies } = await startHarness(t);
  const replies = [];

  for (let index = 0; index < 5; index += 1) {
    const result = await callCodec(codecOrigin, "Mei Ling, come stai?");
    assert.equal(result.response.status, 200);
    replies.push(result.payload.reply);
  }

  assert.equal(new Set(replies).size, replies.length);
  assert.equal(chatBodies.length, 0);
});

test("richer conversation still uses the local language model", async (t) => {
  const modelReply = "Sono curiosa e diretta, Miura. Preferisco una risposta onesta a una rassicurazione vuota.";
  const { codecOrigin, chatBodies } = await startHarness(t, {
    chatReplies: [modelReply],
  });

  const result = await callCodec(codecOrigin, "Raccontami qualcosa di te con sincerità.");

  assert.equal(result.response.status, 200);
  assert.equal(result.payload.reply, modelReply);
  assert.equal(result.payload.responseMode, "PROBLEM_SOLVING");
  assert.equal(chatBodies.length, 1);
});
test("conversation prompt stays compact while memory and standing instructions persist", async (t) => {
  const seedMessages = Array.from({ length: 24 }, (_, index) => ({
    conversationId: "miura-mei-ling-main-v10",
    role: index % 2 === 0 ? "user" : "assistant",
    content: `storico-${String(index).padStart(2, "0")} ${"contesto lungo e ridondante ".repeat(24)}`,
  }));
  const standing = "Ricordati che i test di latenza vengono prima delle attività in background.";
  const reply = "La priorità è misurare la latenza prima dei lavori in background. Così isoliamo il collo di bottiglia e interveniamo sul punto giusto.";
  const { codecOrigin, chatBodies, brainPath } = await startHarness(t, {
    seedMessages,
    chatReplies: [reply],
  });

  const result = await callCodec(codecOrigin, standing);

  assert.equal(result.response.status, 200);
  assert.equal(chatBodies.length, 1);
  const requestMessages = chatBodies[0].messages;
  const systemPrompt = requestMessages[0].content;
  const promptHistory = requestMessages.slice(1, -1);
  const promptHistoryChars = promptHistory.reduce((sum, turn) => sum + turn.content.length, 0);
  const totalPromptChars = requestMessages.reduce((sum, turn) => sum + turn.content.length, 0);
  assert.ok(promptHistory.length <= 8);
  assert.ok(promptHistoryChars <= 1_000);
  assert.ok(systemPrompt.length <= 5_500, `system prompt has ${systemPrompt.length} characters`);
  assert.ok(totalPromptChars <= 6_700, `request prompt has ${totalPromptChars} characters`);
  assert.match(systemPrompt, /PRESENCE AND CHARACTER/u);
  assert.match(systemPrompt, /donna adulta/u);
  assert.match(systemPrompt, /approvazione esplicita/u);
  assert.match(systemPrompt, /DATA LOCALE CORRENTE:/u);
  assert.match(systemPrompt, /memoria del modello non è una fonte per fatti correnti/u);
  assert.ok(systemPrompt.includes(standing));
  assert.equal(promptHistory.some((turn) => turn.content.includes("storico-00")), false);
  assert.equal(promptHistory.some((turn) => turn.content.includes("storico-23")), true);

  const inspectionDb = openBrainDb({ filename: brainPath });
  try {
    const persisted = inspectionDb.getConversationHistory({
      conversationId: "miura-mei-ling-main-v10",
      limit: 100,
    });
    assert.equal(persisted.length, 26);
    assert.ok(persisted.some((turn) => turn.content === standing));
  } finally {
    inspectionDb.close();
  }
});
