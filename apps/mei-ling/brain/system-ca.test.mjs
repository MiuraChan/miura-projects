import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import systemCa from "../desktop/system-ca.cjs";

const { appendSystemCaOption, withWindowsSystemCa } = systemCa;

test("desktop child processes use the Windows system CA without disabling TLS verification", () => {
  const environment = withWindowsSystemCa({
    NODE_OPTIONS: "--max-old-space-size=512",
    NODE_TLS_REJECT_UNAUTHORIZED: "1",
  });

  assert.equal(environment.NODE_USE_SYSTEM_CA, "1");
  assert.equal(
    environment.NODE_OPTIONS,
    "--max-old-space-size=512 --use-system-ca",
  );
  assert.equal(environment.NODE_TLS_REJECT_UNAUTHORIZED, "1");
  assert.equal("NODE_EXTRA_CA_CERTS" in environment, false);
});

test("system CA option is appended only once", () => {
  assert.equal(
    appendSystemCaOption("--use-system-ca --trace-warnings"),
    "--use-system-ca --trace-warnings",
  );
});

test("desktop spawn path applies the system CA environment to every child", async () => {
  const source = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  assert.match(source, /env: withWindowsSystemCa\(\{ \.\.\.process\.env, \.\.\.env \}\)/u);
});
