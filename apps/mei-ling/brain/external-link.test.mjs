import test from "node:test";
import assert from "node:assert/strict";
import externalLink from "../desktop/external-link.cjs";

const { isSafeExternalNewsUrl, normalizeExternalNewsUrl } = externalLink;

test("external news links allow ordinary HTTPS pages", () => {
  assert.equal(isSafeExternalNewsUrl("https://www.capcom-games.com/news?id=42"), true);
  assert.equal(
    normalizeExternalNewsUrl(" https://news.google.com/rss/articles/example "),
    "https://news.google.com/rss/articles/example",
  );
});

test("external news links reject unsafe protocols and local destinations", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///C:/Windows/System32/drivers/etc/hosts",
    "http://example.com/news",
    "https://localhost/news",
    "https://127.0.0.1/news",
    "https://192.168.1.20/news",
    "https://[::1]/news",
    "https://user:password@example.com/news",
  ]) {
    assert.equal(isSafeExternalNewsUrl(url), false, url);
  }
});
