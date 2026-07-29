import { createHash } from "node:crypto";

/**
 * Actions that only prepare material locally may run unattended. Everything
 * that mutates the outside world (or destroys data) needs a fresh approval for
 * that exact action payload.
 */
export const POLICY_MODE = Object.freeze({
  AUTONOMOUS: "autonomous",
  APPROVAL_REQUIRED: "approval_required",
});

const APPROVAL_RULES = Object.freeze([
  {
    category: "delete",
    pattern: /\b(delete|remove|erase|purge|destroy|wipe|trash)\b/i,
    reason: "Deleting data requires approval.",
  },
  {
    category: "security",
    pattern:
      /\b(security|password|credential|secret|api[_\s.-]?key|permission|firewall|antivirus|norton|2fa|mfa)\b/i,
    reason: "Security and credential changes require approval.",
  },
  {
    category: "spend",
    pattern:
      /\b(spend|purchase|buy|payment|pay|subscribe|subscription|charge|donate|bid)\b/i,
    reason: "Spending or financial commitments require approval.",
  },
  {
    category: "publish",
    pattern:
      /\b(publish|post|release|go[_\s.-]?live|livestream|broadcast|make[_\s.-]?public)\b/i,
    reason: "Publishing externally requires approval.",
  },
  {
    category: "message",
    pattern:
      /\b(send|message|email|e-mail|dm|direct[_\s.-]?message|reply|comment|contact|notify)\b/i,
    reason: "Sending a message to another person requires approval.",
  },
  {
    category: "upload",
    pattern: /\b(upload|attach|transfer|share[_\s.-]?file)\b/i,
    reason: "Uploading or sharing a file requires approval.",
  },
  {
    category: "account",
    pattern:
      /\b(account|profile[_\s.-]?(edit|change|update)|login|log[_\s.-]?in|logout|log[_\s.-]?out|register|oauth|connect[_\s.-]?account)\b/i,
    reason: "Account changes or connections require approval.",
  },
]);

const LOCAL_PREP_PATTERN =
  /^(local[.:/_-])|(\b(research|search|read|fetch|monitor|scan|analy[sz]e|analysis|draft|summari[sz]e|plan|rank|score|transcribe|generate|prepare|outline|brainstorm|store|index|classify|tag|render[_\s.-]?preview)\b)/i;

function normalizeActionType(type) {
  if (typeof type !== "string" || !type.trim()) {
    throw new TypeError("Action type must be a non-empty string.");
  }

  return type.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Deterministically serializes JSON-like data. Object keys are sorted, unsafe
 * prototype keys are omitted, dates become ISO strings and bigint becomes a
 * decimal string. Circular values and non-finite numbers are rejected.
 */
export function stableJson(value) {
  const seen = new Set();

  const normalize = (input, inArray = false) => {
    if (input === null || typeof input === "string" || typeof input === "boolean") {
      return input;
    }

    if (typeof input === "number") {
      if (!Number.isFinite(input)) {
        throw new TypeError("Action payload cannot contain non-finite numbers.");
      }
      return Object.is(input, -0) ? 0 : input;
    }

    if (typeof input === "bigint") {
      return input.toString();
    }

    if (input instanceof Date) {
      if (Number.isNaN(input.getTime())) {
        throw new TypeError("Action payload cannot contain an invalid Date.");
      }
      return input.toISOString();
    }

    if (
      typeof input === "undefined" ||
      typeof input === "function" ||
      typeof input === "symbol"
    ) {
      return inArray ? null : undefined;
    }

    if (typeof input !== "object") {
      return input;
    }

    if (seen.has(input)) {
      throw new TypeError("Action payload cannot contain circular references.");
    }
    seen.add(input);

    let output;
    if (Array.isArray(input)) {
      output = input.map((entry) => normalize(entry, true));
    } else {
      output = {};
      for (const key of Object.keys(input).sort()) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          continue;
        }
        const normalized = normalize(input[key], false);
        if (normalized !== undefined) {
          output[key] = normalized;
        }
      }
    }

    seen.delete(input);
    return output;
  };

  return JSON.stringify(normalize(value));
}

/** Returns the SHA-256 hash binding an approval to one type and payload. */
export function hashActionPayload(type, payload) {
  return createHash("sha256")
    .update(stableJson({ type: normalizeActionType(type), payload }))
    .digest("hex");
}

/**
 * Classifies an action. Unknown actions fail closed and require approval.
 * This lets callers add capabilities without silently expanding autonomy.
 */
export function classifyAction(type) {
  const normalizedType = normalizeActionType(type);
  const searchableType = normalizedType.replace(/[.:/_-]+/g, " ");

  for (const rule of APPROVAL_RULES) {
    if (rule.pattern.test(searchableType)) {
      return Object.freeze({
        type: normalizedType,
        mode: POLICY_MODE.APPROVAL_REQUIRED,
        category: rule.category,
        reason: rule.reason,
      });
    }
  }

  if (
    LOCAL_PREP_PATTERN.test(normalizedType) ||
    LOCAL_PREP_PATTERN.test(searchableType)
  ) {
    return Object.freeze({
      type: normalizedType,
      mode: POLICY_MODE.AUTONOMOUS,
      category: "local_prep",
      reason: "Local preparation is safe to run autonomously.",
    });
  }

  return Object.freeze({
    type: normalizedType,
    mode: POLICY_MODE.APPROVAL_REQUIRED,
    category: "unknown",
    reason: "Unknown capabilities require approval by default.",
  });
}

export function requiresApproval(type) {
  return classifyAction(type).mode === POLICY_MODE.APPROVAL_REQUIRED;
}
