const GREETING_ONLY = /^(?:ciao|salve|buongiorno|buonasera|ehi|hey|hello|hi)(?:\s+(?:mei\s*ling|mei))?[!.?\s]*$/iu;

export const EDITORIAL_AUTO_DELAY_MS = 6_000;
export const EDITORIAL_AUTO_FALLBACK_TOKEN = "__AUTO_AFTER_6S__";

function normalizedCommand(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[’']/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isEditorialGreeting(value) {
  return GREETING_ONLY.test(normalizedCommand(value));
}

export function isEditorialConsent(value) {
  const text = normalizedCommand(value)
    .replace(/[.!?]+$/gu, "")
    .trim();
  if (/^come\s+vai\b/u.test(text) || /\bse\s+dico\s+vai\b/u.test(text) || /^how\s+are\s+you\b/u.test(text)) return false;
  return /^(?:(?:ciao|salve|buongiorno|buonasera|ehi|hey|hello|hi)(?:\s+(?:mei\s*ling|mei))?[,!\s]+)?(?:vai|vai\s+pure|procedi|prepara(?:mi)?\s+(?:il\s+)?(?:piano|calendario|progetto)\s+(?:editoriale|della\s+settimana)|vai\s+con\s+(?:il\s+)?(?:piano|calendario|progetto)\s+editoriale|go|go\s+ahead|proceed|prepare\s+(?:the\s+)?(?:(?:weekly|editorial)\s+)*(?:plan|calendar))$/u.test(text);
}

function timestamp(value) {
  const number = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createEditorialFlowState() {
  return Object.freeze({
    phase: "awaiting-user-greeting",
    consented: false,
    planDelivered: false,
    armedAt: null,
    triggerClaimed: false,
    triggerSource: null,
    replyInFlight: false,
  });
}

export function classifyEditorialTurn(state, message, { now = Date.now() } = {}) {
  const current = state || createEditorialFlowState();
  if (isEditorialConsent(message)) {
    if (current.triggerClaimed || current.replyInFlight || current.planDelivered) {
      return Object.freeze({ type: "already-triggered", nextState: current });
    }
    return Object.freeze({
      type: "consent",
      nextState: Object.freeze({
        phase: "research-approved",
        consented: true,
        planDelivered: current.planDelivered === true,
        armedAt: current.armedAt,
        triggerClaimed: true,
        triggerSource: "explicit",
        replyInFlight: true,
      }),
    });
  }
  if (isEditorialGreeting(message)) {
    if (current.triggerClaimed || current.replyInFlight || current.planDelivered) {
      return Object.freeze({ type: "already-triggered", nextState: current });
    }
    const armedAt = timestamp(now);
    if (armedAt === null) {
      return Object.freeze({ type: "conversation", nextState: current });
    }
    return Object.freeze({
      type: "greeting",
      nextState: Object.freeze({
        phase: "awaiting-explicit-consent",
        consented: false,
        planDelivered: current.planDelivered === true,
        armedAt,
        triggerClaimed: false,
        triggerSource: null,
        replyInFlight: false,
      }),
    });
  }
  return Object.freeze({ type: "conversation", nextState: current });
}

/**
 * Atomically claims the six-second fallback. Callers must store nextState
 * before starting research; later explicit turns will then be classified as
 * already-triggered instead of opening a second reply.
 */
export function claimTimedEditorialFallback(
  state,
  {
    token,
    now = Date.now(),
    delayMs = EDITORIAL_AUTO_DELAY_MS,
  } = {},
) {
  const current = state || createEditorialFlowState();
  const currentTime = timestamp(now);
  const minimumDelay = Math.max(EDITORIAL_AUTO_DELAY_MS, Number(delayMs) || 0);
  const eligible = token === EDITORIAL_AUTO_FALLBACK_TOKEN
    && current.phase === "awaiting-explicit-consent"
    && current.armedAt !== null
    && currentTime !== null
    && currentTime - current.armedAt >= minimumDelay
    && !current.triggerClaimed
    && !current.replyInFlight
    && !current.planDelivered;

  if (!eligible) {
    return Object.freeze({
      claimed: false,
      type: "fallback-not-eligible",
      nextState: current,
    });
  }

  return Object.freeze({
    claimed: true,
    type: "timed-fallback",
    command: EDITORIAL_AUTO_FALLBACK_TOKEN,
    nextState: Object.freeze({
      ...current,
      phase: "research-approved",
      consented: true,
      triggerClaimed: true,
      triggerSource: "timed-fallback",
      replyInFlight: true,
    }),
  });
}

export function editorialFallbackDelayRemaining(state, { now = Date.now() } = {}) {
  const current = state || createEditorialFlowState();
  const currentTime = timestamp(now);
  if (
    current.phase !== "awaiting-explicit-consent"
    || current.armedAt === null
    || currentTime === null
    || current.triggerClaimed
    || current.replyInFlight
    || current.planDelivered
  ) return null;
  return Math.max(0, EDITORIAL_AUTO_DELAY_MS - (currentTime - current.armedAt));
}

export function armEditorialFallbackWindow(state, { now = Date.now() } = {}) {
  const current = state || createEditorialFlowState();
  const armedAt = timestamp(now);
  if (
    armedAt === null
    || current.triggerClaimed
    || current.replyInFlight
    || current.planDelivered
  ) return current;
  return Object.freeze({
    ...current,
    phase: "awaiting-explicit-consent",
    consented: false,
    armedAt,
    triggerClaimed: false,
    triggerSource: null,
    replyInFlight: false,
  });
}

/**
 * Small integration helper for the UI. Schedule it only after Mei Ling's
 * greeting has finished. It re-reads state when the timer fires, claims state
 * synchronously before invoking async work, and therefore cannot race a user
 * consent into a second plan request.
 */
export function scheduleTimedEditorialFallback({
  getState,
  setState,
  onClaim,
  onError = () => {},
  now = () => Date.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timerId) => clearTimeout(timerId),
} = {}) {
  if (
    typeof getState !== "function"
    || typeof setState !== "function"
    || typeof onClaim !== "function"
    || typeof now !== "function"
    || typeof setTimer !== "function"
    || typeof clearTimer !== "function"
  ) throw new TypeError("Editorial fallback scheduler requires state and timer callbacks");

  const delayMs = editorialFallbackDelayRemaining(getState(), { now: now() });
  if (delayMs === null) {
    return Object.freeze({ scheduled: false, delayMs: null, cancel() {} });
  }

  let cancelled = false;
  const timerId = setTimer(() => {
    if (cancelled) return;
    const claim = claimTimedEditorialFallback(getState(), {
      token: EDITORIAL_AUTO_FALLBACK_TOKEN,
      now: now(),
    });
    if (!claim.claimed) return;
    setState(claim.nextState);
    Promise.resolve(onClaim(claim)).catch(onError);
  }, delayMs);

  return Object.freeze({
    scheduled: true,
    delayMs,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      clearTimer(timerId);
    },
  });
}

export function markEditorialPlanDelivered(state) {
  return Object.freeze({
    ...(state || createEditorialFlowState()),
    phase: "plan-delivered",
    consented: true,
    planDelivered: true,
    triggerClaimed: true,
    replyInFlight: false,
  });
}

export function markEditorialPlanFailed(state, { now = Date.now() } = {}) {
  const current = state || createEditorialFlowState();
  const rearmedAt = timestamp(now);
  return Object.freeze({
    ...current,
    phase: "awaiting-explicit-consent",
    consented: false,
    planDelivered: false,
    armedAt: rearmedAt,
    triggerClaimed: false,
    triggerSource: null,
    replyInFlight: false,
  });
}
