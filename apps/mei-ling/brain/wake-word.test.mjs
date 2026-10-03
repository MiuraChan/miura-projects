import assert from "node:assert/strict";
import test from "node:test";

import { isMeiLingWakePhrase, normalizeWakePhrase } from "../public/wake-word.js";

test("wake phrase accepts the requested Italian phrase and local STT variants", () => {
  for (const phrase of [
    "Hey Mei Ling, ci sei?",
    "Ehi MeiLing ci sei",
    "Mei Link, ci sei?",
    "Ai miei link ci sei",
    "Hei May Ling ci sei",
    "Hai Mei Ling ci sei?",
    "Hey Mailing, ci sei?",
    "Eh Mi Lin ci sei",
    "Mai Ling ci 6",
    "Meling ci sei per favore",
  ]) {
    assert.equal(isMeiLingWakePhrase(phrase), true, phrase);
  }
});

test("wake phrase stays strict and never treats a command as a wake control", () => {
  for (const phrase of [
    "Mei Ling",
    "Mei Ling hai fatto colazione?",
    "Ehi, ci sei?",
    "Hey Mei Ling ci sei, cerca le news",
    "Hey Mei Ling ci sei per favore cerca le news",
    "Hey Mei Ling sei qui?",
    "Mailing list ci sei",
    "Hey Mei Ling ci sei davvero?",
  ]) {
    assert.equal(isMeiLingWakePhrase(phrase), false, phrase);
  }
});

test("wake normalization is punctuation and accent tolerant", () => {
  assert.equal(normalizeWakePhrase("  Èhi—Mei   Ling, CI SEI?! "), "ehi mei ling ci sei");
});
