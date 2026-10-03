(function installMeiVoiceOwner(root) {
  "use strict";

  const PROTOCOL = "mei-voice-owner/1";
  const DEFAULT_CHANNEL = "mei-ling-voice-owner-v1";
  const DEFAULT_LEASE_MS = 2_400;
  const DEFAULT_HEARTBEAT_MS = 700;
  const DEFAULT_CLAIM_WINDOW_MS = 120;

  function asPositiveNumber(value, fallback, minimum) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= minimum ? numeric : fallback;
  }

  function safeInvoke(callback, value) {
    if (typeof callback !== "function") return;
    try {
      callback(value);
    } catch (error) {
      root.console?.error?.("[MeiVoiceOwner] callback failed", error);
    }
  }

  function randomId(cryptoObject) {
    if (typeof cryptoObject?.randomUUID === "function") {
      return cryptoObject.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function create(options = {}) {
    const windowObject = options.window || (typeof window !== "undefined" ? window : null);
    const documentObject = options.document || windowObject?.document || null;
    const now = typeof options.now === "function" ? options.now : Date.now;
    const setTimeoutFn = options.setTimeout || root.setTimeout?.bind(root) || setTimeout;
    const clearTimeoutFn = options.clearTimeout || root.clearTimeout?.bind(root) || clearTimeout;
    const setIntervalFn = options.setInterval || root.setInterval?.bind(root) || setInterval;
    const clearIntervalFn = options.clearInterval || root.clearInterval?.bind(root) || clearInterval;
    const hasBroadcastOverride = Object.prototype.hasOwnProperty.call(options, "BroadcastChannel");
    const BroadcastChannelClass = hasBroadcastOverride
      ? options.BroadcastChannel
      : windowObject?.BroadcastChannel || root.BroadcastChannel;
    const channelName = String(options.channelName || DEFAULT_CHANNEL);
    const heartbeatMs = asPositiveNumber(options.heartbeatMs, DEFAULT_HEARTBEAT_MS, 20);
    const leaseMs = Math.max(
      asPositiveNumber(options.leaseMs, DEFAULT_LEASE_MS, 60),
      heartbeatMs * 2.5,
    );
    const claimWindowMs = asPositiveNumber(options.claimWindowMs, DEFAULT_CLAIM_WINDOW_MS, 10);
    const tabId = String(options.tabId || randomId(windowObject?.crypto || root.crypto));
    const autoClaimOnFocus = options.autoClaimOnFocus === true;
    const subscribers = new Set();
    const candidates = new Map();

    let channel = null;
    let destroyed = false;
    let owned = false;
    let activeClaimId = null;
    let remoteOwner = null;
    let pendingClaim = null;
    let tickTimer = null;

    function isEligible() {
      if (destroyed) return false;
      if (documentObject?.hidden === true || documentObject?.visibilityState === "hidden") {
        return false;
      }
      // Embedded/in-app browsers often report hasFocus() === false even for the
      // visible interactive page. BroadcastChannel already elects one owner, so
      // visibility is the correct eligibility signal in coordinated mode.
      if (channel) return true;

      // Without cross-tab coordination, stay conservative and allow only the
      // focused tab to own the microphone.

      if (typeof documentObject?.hasFocus === "function") {
        try {
          if (!documentObject.hasFocus()) return false;
        } catch {
          return false;
        }
      }
      return true;
    }

    function validRemoteOwner() {
      if (!remoteOwner) return null;
      if (remoteOwner.leaseUntil > now()) return remoteOwner;
      const previousOwnerId = remoteOwner.tabId;
      remoteOwner = null;
      emitChange("lease-expired", previousOwnerId);
      return null;
    }

    function snapshot(reason = "state") {
      const remote = owned ? null : validRemoteOwner();
      return Object.freeze({
        tabId,
        ownerId: owned ? tabId : remote?.tabId || null,
        isOwner: owned && isEligible(),
        eligible: isEligible(),
        coordinated: Boolean(channel),
        reason,
      });
    }

    function emitChange(reason, previousOwnerId = null, ownershipEvent = null) {
      const state = snapshot(reason);
      const event = Object.freeze({ ...state, previousOwnerId });
      safeInvoke(options.onChange, event);
      for (const listener of subscribers) safeInvoke(listener, event);
      if (ownershipEvent === "gained") safeInvoke(options.onGained, event);
      if (ownershipEvent === "lost") safeInvoke(options.onLost, event);
    }

    function post(type, payload = {}) {
      if (!channel) return false;
      try {
        channel.postMessage({
          protocol: PROTOCOL,
          type,
          tabId,
          sentAt: now(),
          ...payload,
        });
        return true;
      } catch {
        return false;
      }
    }

    function sendLease(reason = "heartbeat") {
      if (!owned || !activeClaimId) return;
      if (!isEligible()) {
        release("ineligible");
        return;
      }
      post("lease", {
        claimId: activeClaimId,
        leaseUntil: now() + leaseMs,
        reason,
      });
    }

    function settlePendingClaim(value) {
      if (!pendingClaim) return;
      const pending = pendingClaim;
      pendingClaim = null;
      if (pending.timer) clearTimeoutFn(pending.timer);
      candidates.delete(pending.claimId);
      pending.resolve(Boolean(value));
    }

    function loseOwnership(reason, nextRemoteOwner = null) {
      const wasOwned = owned;
      const previousOwnerId = wasOwned ? tabId : validRemoteOwner()?.tabId || null;
      owned = false;
      activeClaimId = null;
      remoteOwner = nextRemoteOwner;
      if (wasOwned) emitChange(reason, previousOwnerId, "lost");
    }

    function becomeOwner(claimId, reason) {
      if (!isEligible() || destroyed) return false;
      const previousOwnerId = validRemoteOwner()?.tabId || null;
      owned = true;
      activeClaimId = claimId;
      remoteOwner = null;
      emitChange(reason, previousOwnerId, "gained");
      sendLease(reason);
      return true;
    }

    function claimIdForAttempt() {
      const timestamp = String(Math.max(0, Math.floor(now()))).padStart(16, "0");
      return `${timestamp}:${tabId}:${randomId(windowObject?.crypto || root.crypto)}`;
    }

    function finalizeClaim(claimId) {
      if (!pendingClaim || pendingClaim.claimId !== claimId) return;
      if (!isEligible()) {
        settlePendingClaim(false);
        return;
      }

      const currentTime = now();
      for (const [candidateId, candidate] of candidates) {
        if (candidate.expiresAt <= currentTime) candidates.delete(candidateId);
      }

      const remote = validRemoteOwner();
      if (remote && remote.claimId <= claimId) {
        settlePendingClaim(false);
        return;
      }

      const winningClaimId = [...candidates.keys(), claimId].sort()[0];
      if (winningClaimId !== claimId) {
        settlePendingClaim(false);
        return;
      }

      const won = becomeOwner(claimId, "claimed");
      settlePendingClaim(won);
    }

    function claim(reason = "explicit") {
      if (destroyed || !isEligible()) return Promise.resolve(false);
      if (owned) return Promise.resolve(true);
      if (pendingClaim) return pendingClaim.promise;
      if (validRemoteOwner()) return Promise.resolve(false);

      const claimId = claimIdForAttempt();
      if (!channel) {
        return Promise.resolve(becomeOwner(claimId, `${reason}:focus-fallback`));
      }

      let resolveClaim;
      const promise = new Promise((resolve) => {
        resolveClaim = resolve;
      });
      const expiresAt = now() + claimWindowMs + 100;
      candidates.set(claimId, { tabId, expiresAt });
      pendingClaim = {
        claimId,
        promise,
        resolve: resolveClaim,
        timer: setTimeoutFn(() => finalizeClaim(claimId), claimWindowMs),
      };
      post("candidate", { claimId, expiresAt, reason });
      return promise;
    }

    function release(reason = "explicit") {
      if (pendingClaim) settlePendingClaim(false);
      if (!owned) return false;
      const previousOwnerId = tabId;
      const claimId = activeClaimId;
      post("release", { claimId, reason });
      owned = false;
      activeClaimId = null;
      remoteOwner = null;
      emitChange(reason, previousOwnerId, "lost");
      return true;
    }

    function onChannelMessage(event) {
      const message = event?.data;
      if (!message || message.protocol !== PROTOCOL || message.tabId === tabId) return;
      const currentTime = now();

      if (message.type === "candidate") {
        if (typeof message.claimId !== "string" || Number(message.expiresAt) <= currentTime) return;
        candidates.set(message.claimId, {
          tabId: String(message.tabId),
          expiresAt: Number(message.expiresAt),
        });
        if (owned) sendLease("candidate-observed");
        return;
      }

      if (message.type === "lease") {
        if (
          typeof message.claimId !== "string"
          || !Number.isFinite(Number(message.leaseUntil))
          || Number(message.leaseUntil) <= currentTime
        ) {
          return;
        }
        const incoming = {
          tabId: String(message.tabId),
          claimId: message.claimId,
          leaseUntil: Number(message.leaseUntil),
        };

        if (owned) {
          if (incoming.claimId < activeClaimId) {
            loseOwnership("lease-conflict", incoming);
          } else {
            sendLease("conflict-resolved");
          }
          return;
        }

        const previousOwnerId = validRemoteOwner()?.tabId || null;
        if (!remoteOwner || incoming.claimId <= remoteOwner.claimId) {
          remoteOwner = incoming;
        }
        if (pendingClaim && incoming.claimId < pendingClaim.claimId) {
          settlePendingClaim(false);
        }
        if (previousOwnerId !== remoteOwner.tabId) {
          emitChange("remote-lease", previousOwnerId);
        }
        return;
      }

      if (message.type === "release" && remoteOwner?.tabId === String(message.tabId)) {
        if (!message.claimId || message.claimId === remoteOwner.claimId) {
          const previousOwnerId = remoteOwner.tabId;
          if (message.claimId) candidates.delete(message.claimId);
          remoteOwner = null;
          emitChange("remote-release", previousOwnerId);
          if (autoClaimOnFocus && isEligible()) void claim("remote-release");
        }
      }
    }

    function onVisibilityChange() {
      if (!isEligible()) {
        release("hidden");
      } else if (autoClaimOnFocus) {
        void claim("visible");
      }
    }

    function onBlur() {
      if (!channel) release("blurred");
    }

    function onFocus() {
      if (autoClaimOnFocus && isEligible()) void claim("focused");
    }

    function onPageHide() {
      release("pagehide");
    }

    function onTick() {
      if (destroyed) return;
      if (owned) {
        sendLease("heartbeat");
        return;
      }
      const hadRemote = Boolean(remoteOwner);
      validRemoteOwner();
      if (hadRemote && !remoteOwner && autoClaimOnFocus && isEligible()) {
        void claim("lease-expired");
      }
    }

    try {
      if (typeof BroadcastChannelClass === "function") {
        channel = new BroadcastChannelClass(channelName);
        if (typeof channel.addEventListener === "function") {
          channel.addEventListener("message", onChannelMessage);
        } else {
          channel.onmessage = onChannelMessage;
        }
      }
    } catch {
      channel = null;
    }

    documentObject?.addEventListener?.("visibilitychange", onVisibilityChange);
    windowObject?.addEventListener?.("blur", onBlur);
    windowObject?.addEventListener?.("focus", onFocus);
    windowObject?.addEventListener?.("pagehide", onPageHide);
    tickTimer = setIntervalFn(onTick, heartbeatMs);

    function isOwner() {
      if (owned && !isEligible()) release("ineligible-check");
      return owned && isEligible();
    }

    function subscribe(listener, { immediate = true } = {}) {
      if (typeof listener !== "function") return () => {};
      subscribers.add(listener);
      if (immediate) safeInvoke(listener, snapshot("subscribed"));
      return () => subscribers.delete(listener);
    }

    function destroy() {
      if (destroyed) return;
      release("destroyed");
      destroyed = true;
      if (tickTimer) clearIntervalFn(tickTimer);
      tickTimer = null;
      documentObject?.removeEventListener?.("visibilitychange", onVisibilityChange);
      windowObject?.removeEventListener?.("blur", onBlur);
      windowObject?.removeEventListener?.("focus", onFocus);
      windowObject?.removeEventListener?.("pagehide", onPageHide);
      try {
        if (typeof channel?.removeEventListener === "function") {
          channel.removeEventListener("message", onChannelMessage);
        } else if (channel) {
          channel.onmessage = null;
        }
        channel?.close?.();
      } catch {
        // The page may already be tearing down.
      }
      channel = null;
      subscribers.clear();
    }

    return Object.freeze({
      claim,
      release,
      isOwner,
      getState: (reason = "read") => snapshot(reason),
      subscribe,
      destroy,
    });
  }

  root.MeiVoiceOwner = Object.freeze({
    create,
    protocol: PROTOCOL,
  });
})(typeof window !== "undefined" ? window : globalThis);
