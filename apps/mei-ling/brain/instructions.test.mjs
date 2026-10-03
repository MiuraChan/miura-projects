import assert from "node:assert/strict";
import test from "node:test";
import { extractStandingInstruction } from "./instructions.mjs";

test("captures explicit persistent Italian preferences", () => {
  assert.equal(
    extractStandingInstruction("Ricordati che devi chiamarmi sempre Miura.")?.text,
    "Ricordati che devi chiamarmi sempre Miura.",
  );
});

test("captures explicit persistent English preferences", () => {
  assert.equal(
    extractStandingInstruction("From now on, never publish without my approval.")?.scope,
    "conversation",
  );
});

test("does not persist a transient request", () => {
  assert.equal(
    extractStandingInstruction("Voglio che tu mi dia tre idee oggi."),
    null,
  );
});

test("ignores ordinary conversation", () => {
  assert.equal(extractStandingInstruction("Che cosa registriamo?"), null);
});

test("captures a conditional gaming-news rule even when it mentions today", () => {
  const result = extractStandingInstruction(
    "Allora quando ti chiedo le news del giorno tu devi lavorare soltanto su tutte le fonti editoriali di gaming e basta ok?",
  );
  assert.equal(result?.scope, "conversation");
  assert.match(result?.text || "", /fonti editoriali di gaming/iu);
});

test("keeps a one-off request for today's gaming news transient", () => {
  assert.equal(extractStandingInstruction("Dammi le news di oggi sui videogiochi."), null);
});
