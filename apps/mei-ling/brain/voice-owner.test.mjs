import assert from "node:assert/strict";
import test from "node:test";

await import("../public/voice-owner.js");

const { create } = globalThis.MeiVoiceOwner;

class FakeDocument extends EventTarget {
  constructor() {
    super();
    this.hidden = false;
    this.visibilityState = "visible";
    this.focused = true;
  }

  hasFocus() {
    return this.focused;
  }
}

class FakeWindow extends EventTarget {
  constructor(document, BroadcastChannel) {
    super();
    this.document = document;
    this.BroadcastChannel = BroadcastChannel;
  }
}

class BroadcastHub {
  constructor() {
    this.channels = new Map();
  }

  channelClass() {
    const hub = this;
    return class FakeBroadcastChannel {
      constructor(name) {
        this.name = name;
        this.listeners = new Set();
        this.onmessage = null;
        if (!hub.channels.has(name)) hub.channels.set(name, new Set());
        hub.channels.get(name).add(this);
      }

      addEventListener(type, listener) {
        if (type === "message") this.listeners.add(listener);
      }

      removeEventListener(type, listener) {
        if (type === "message") this.listeners.delete(listener);
      }

      postMessage(data) {
        for (const peer of hub.channels.get(this.name) || []) {
          if (peer === this) continue;
          queueMicrotask(() => {
            const event = { data };
            for (const listener of peer.listeners) listener(event);
            peer.onmessage?.(event);
          });
        }
      }

      close() {
        hub.channels.get(this.name)?.delete(this);
      }
    };
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function harness(hub, tabId, callbacks = {}) {
  const document = new FakeDocument();
  const BroadcastChannel = hub.channelClass();
  const window = new FakeWindow(document, BroadcastChannel);
  const owner = create({
    window,
    document,
    BroadcastChannel,
    tabId,
    channelName: "test-voice-owner",
    heartbeatMs: 25,
    leaseMs: 100,
    claimWindowMs: 15,
    ...callbacks,
  });
  return { document, window, owner };
}

test("simultaneous claims elect exactly one voice owner", async (t) => {
  const hub = new BroadcastHub();
  const a = harness(hub, "tab-a");
  const b = harness(hub, "tab-b");
  t.after(() => {
    a.owner.destroy();
    b.owner.destroy();
  });

  const results = await Promise.all([a.owner.claim(), b.owner.claim()]);
  await delay(5);

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal([a.owner.isOwner(), b.owner.isOwner()].filter(Boolean).length, 1);
  assert.equal(a.owner.getState().ownerId, b.owner.getState().ownerId);
});

test("a visible coordinated in-app tab can own voice when hasFocus is false", async (t) => {
  const hub = new BroadcastHub();
  const a = harness(hub, "embedded-tab-a");
  const b = harness(hub, "embedded-tab-b");
  t.after(() => {
    a.owner.destroy();
    b.owner.destroy();
  });

  a.document.focused = false;
  b.document.focused = false;

  const results = await Promise.all([a.owner.claim(), b.owner.claim()]);
  await delay(5);

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal([a.owner.isOwner(), b.owner.isOwner()].filter(Boolean).length, 1);
  assert.equal(a.owner.getState().eligible, true);
  assert.equal(b.owner.getState().eligible, true);
  assert.equal(a.owner.getState().ownerId, b.owner.getState().ownerId);
});

test("coordinated owner keeps its lease when a visible embedded tab blurs", async (t) => {
  const hub = new BroadcastHub();
  const a = harness(hub, "embedded-tab");
  t.after(() => a.owner.destroy());

  a.document.focused = false;
  assert.equal(await a.owner.claim(), true);
  a.window.dispatchEvent(new Event("blur"));

  assert.equal(a.owner.isOwner(), true);
  assert.equal(a.owner.getState().coordinated, true);
});

test("the owner releases immediately when hidden and another tab can claim", async (t) => {
  const hub = new BroadcastHub();
  const a = harness(hub, "tab-a");
  const b = harness(hub, "tab-b");
  t.after(() => {
    a.owner.destroy();
    b.owner.destroy();
  });

  assert.equal(await a.owner.claim(), true);
  a.document.hidden = true;
  a.document.visibilityState = "hidden";
  a.document.focused = false;
  a.document.dispatchEvent(new Event("visibilitychange"));
  await delay(5);

  assert.equal(a.owner.isOwner(), false);
  assert.equal(await b.owner.claim(), true);
  assert.equal(b.owner.isOwner(), true);
});

test("pagehide releases ownership and reports the loss callback", async (t) => {
  const losses = [];
  const hub = new BroadcastHub();
  const a = harness(hub, "tab-a", { onLost: (event) => losses.push(event) });
  t.after(() => a.owner.destroy());

  assert.equal(await a.owner.claim(), true);
  a.window.dispatchEvent(new Event("pagehide"));

  assert.equal(a.owner.isOwner(), false);
  assert.equal(losses.length, 1);
  assert.equal(losses[0].reason, "pagehide");
});

test("without BroadcastChannel it falls back to focused-tab ownership", async (t) => {
  const document = new FakeDocument();
  const window = new FakeWindow(document, null);
  const changes = [];
  const owner = create({
    window,
    document,
    BroadcastChannel: null,
    tabId: "fallback-tab",
    heartbeatMs: 25,
    onChange: (event) => changes.push(event),
  });
  t.after(() => owner.destroy());

  assert.equal(await owner.claim(), true);
  assert.equal(owner.isOwner(), true);
  assert.equal(owner.getState().coordinated, false);

  document.focused = false;
  window.dispatchEvent(new Event("blur"));
  assert.equal(owner.isOwner(), false);
  assert.ok(changes.some((event) => event.reason === "blurred"));

  document.hidden = true;
  assert.equal(await owner.claim(), false);
});
