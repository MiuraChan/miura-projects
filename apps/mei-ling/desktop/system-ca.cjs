"use strict";

const SYSTEM_CA_OPTION = "--use-system-ca";

function appendSystemCaOption(value) {
  const options = String(value || "").trim();
  if (/(?:^|\s)--use-system-ca(?:\s|$)/u.test(options)) return options;
  return [options, SYSTEM_CA_OPTION].filter(Boolean).join(" ");
}

function withWindowsSystemCa(environment = {}) {
  return {
    ...environment,
    NODE_USE_SYSTEM_CA: "1",
    NODE_OPTIONS: appendSystemCaOption(environment.NODE_OPTIONS),
  };
}

module.exports = {
  appendSystemCaOption,
  withWindowsSystemCa,
};
