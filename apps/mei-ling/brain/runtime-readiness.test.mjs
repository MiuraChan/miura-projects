import test from "node:test";
import assert from "node:assert/strict";
import {
  describeRuntimeConnection,
  describeRuntimeHealth,
} from "../public/runtime-readiness.js";

test("runtime is enabled only after the complete local stack reports READY", () => {
  assert.deepEqual(describeRuntimeHealth({
    ok: true,
    code: "READY",
    dependencies: {
      brain: { ok: true },
      voice: { ok: true },
      hearing: { ok: true },
    },
  }), {
    ready: true,
    status: "STANDBY",
    message: "",
    pending: [],
  });
});

test("runtime warmup identifies only dependencies that are not ready", () => {
  assert.deepEqual(describeRuntimeHealth({
    ok: false,
    code: "DEPENDENCY_NOT_READY",
    dependencies: {
      brain: { ok: true },
      voice: { ok: false },
      hearing: { ok: false },
    },
  }), {
    ready: false,
    status: "AVVIO LOCALE",
    message: "PREPARO VOCE E ASCOLTO…",
    pending: ["VOCE", "ASCOLTO"],
  });
});

test("runtime connection state is concise while the local server appears", () => {
  assert.deepEqual(describeRuntimeConnection(), {
    ready: false,
    status: "AVVIO LOCALE",
    message: "COLLEGO I SERVIZI LOCALI…",
    pending: ["CERVELLO", "VOCE", "ASCOLTO"],
  });
});
