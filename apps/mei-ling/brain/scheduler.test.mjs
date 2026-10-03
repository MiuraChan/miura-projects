import assert from "node:assert/strict";
import test from "node:test";
import { isQuietHours, localDateKey } from "./scheduler.mjs";

test("uses the Europe/Rome calendar date", () => {
  assert.equal(
    localDateKey(new Date("2026-07-28T22:30:00.000Z"), "Europe/Rome"),
    "2026-07-29",
  );
});

test("enforces quiet hours across midnight", () => {
  assert.equal(
    isQuietHours(new Date("2026-07-29T04:00:00.000Z"), { timeZone: "Europe/Rome" }),
    true,
  );
  assert.equal(
    isQuietHours(new Date("2026-07-29T10:00:00.000Z"), { timeZone: "Europe/Rome" }),
    false,
  );
});
