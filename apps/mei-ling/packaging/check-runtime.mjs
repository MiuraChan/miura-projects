import { stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.env.MEI_RUNTIME_ROOT || "packaging/runtime");
const required = [
  ["voice/mei-voice/mei-voice.exe", 100_000],
  ["stt/mei-stt/mei-stt.exe", 100_000],
  ["llm/launcher/mei-llama-server.exe", 100_000],
  ["llm/llama-server-impl.dll", 1_000_000],
  ["llm/ggml-cpu-x64.dll", 500_000],
  ["models/qwen/qwen3-4b-instruct-2507-q4_k_m.gguf", 2_000_000_000],
  ["models/faster-whisper-small/model.bin", 100_000_000],
  ["models/faster-whisper-tiny/model.bin", 50_000_000],
];

const failures = [];
for (const [relativePath, minimumBytes] of required) {
  try {
    const item = await stat(resolve(root, relativePath));
    if (!item.isFile() || item.size < minimumBytes) {
      failures.push(`${relativePath}: file incompleto`);
    }
  } catch {
    failures.push(`${relativePath}: mancante`);
  }
}

if (failures.length) {
  console.error("Runtime standalone non pronto:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(`Runtime standalone completo: ${root}`);
}
