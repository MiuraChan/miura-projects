const DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

function compactText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

export function buildGeminiInteraction(messages, {
  model = "gemini-3.5-flash-lite",
  temperature = 0.55,
  topP = 0.9,
  maxTokens = 220,
} = {}) {
  const normalized = (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : message?.role === "system" ? "system" : "user",
      content: compactText(message?.content),
    }))
    .filter((message) => message.content);
  const systemInstruction = normalized
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const conversation = normalized
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role === "assistant" ? "MEI LING" : "UTENTE"}: ${message.content}`)
    .join("\n");

  if (!conversation) throw new TypeError("Gemini requires at least one user message.");
  return {
    model,
    system_instruction: systemInstruction || undefined,
    input: conversation,
    store: false,
    generation_config: {
      temperature,
      top_p: topP,
      max_output_tokens: maxTokens,
      thinking_level: "low",
    },
  };
}

function textFromInteraction(payload) {
  const direct = compactText(payload?.output_text);
  if (direct) return direct;
  const parts = [];
  for (const step of Array.isArray(payload?.steps) ? payload.steps : []) {
    for (const block of Array.isArray(step?.content) ? step.content : []) {
      const text = compactText(block?.text);
      if (text) parts.push(text);
    }
  }
  return parts.join(" ").trim();
}

export async function requestGeminiCompletion({
  apiKey,
  messages,
  model,
  temperature,
  topP,
  maxTokens,
  timeoutMs = 45_000,
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = fetch,
} = {}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    const error = new Error("GEMINI_API_KEY non configurata.");
    error.code = "GEMINI_KEY_MISSING";
    error.status = 503;
    throw error;
  }
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(buildGeminiInteraction(messages, {
        model,
        temperature,
        topP,
        maxTokens,
      })),
    });
  } catch (cause) {
    const error = new Error("Gemini non è raggiungibile.", { cause });
    error.code = "GEMINI_UNREACHABLE";
    error.status = 503;
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      compactText(payload?.error?.message) || `Gemini ha rifiutato la richiesta (${response.status}).`,
    );
    error.code = response.status === 429 ? "GEMINI_QUOTA" : "GEMINI_HTTP";
    error.status = response.status === 429 ? 429 : 502;
    error.upstreamStatus = response.status;
    throw error;
  }
  const content = textFromInteraction(payload);
  if (!content) {
    const error = new Error("Gemini ha restituito una risposta vuota.");
    error.code = "GEMINI_EMPTY_REPLY";
    error.status = 502;
    throw error;
  }
  return content;
}

