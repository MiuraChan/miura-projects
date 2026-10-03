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
