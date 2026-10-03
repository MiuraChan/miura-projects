import assert from "node:assert/strict";
import test from "node:test";
import {
  editorialRatingLabel,
  normalizeNewsResults,
  safeNewsUrl,
} from "../public/news-result.js";

test("news result normalization keeps three safe HTTPS links and sanitizes display text", () => {
  const results = normalizeNewsResults([
    {
      title: "  Monster\nHunter\u0000 update  ",
      source: " Capcom\nNews ",
      publishedAt: "2026-08-05T09:30:00.000Z",
      url: "https://news.example.com/story?id=1",
      editorialRating: { score: 108.7, verificationRequired: true, reasons: ["Fresh\nsource"] },
    },
    ...Array.from({ length: 4 }, (_, index) => ({
      title: `Story ${index + 2}`,
      source: "Example",
      url: `https://example.com/story-${index + 2}`,
      editorialRating: { score: index * 20 },
    })),
  ]);

  assert.equal(results.length, 3);
  assert.equal(results[0].title, "Monster Hunter update");
  assert.equal(results[0].source, "Capcom News");
  assert.equal(results[0].editorialRating.score, 100);
  assert.equal(results[0].editorialRating.label, "ALTO");
  assert.equal(results[0].editorialRating.verificationRequired, true);
  assert.deepEqual(results[0].editorialRating.reasons, ["Fresh source"]);
});

test("unsafe, local and credentialed news links are rejected", () => {
  const unsafeUrls = [
    "javascript:alert(1)",
    "file:///C:/secret.txt",
    "http://news.example.com/story",
    "https://user:pass@example.com/story",
    "https://localhost/story",
    "https://api.localhost/story",
    "https://device.local/story",
    "https://service.internal/story",
    "https://home.arpa/story",
    "https://127.0.0.1/story",
    "https://10.2.3.4/story",
    "https://172.16.1.1/story",
    "https://192.168.1.1/story",
    "https://169.254.1.1/story",
    "https://203.0.113.7/story",
  ];

  unsafeUrls.forEach((url) => assert.equal(safeNewsUrl(url), "", url));
  assert.equal(safeNewsUrl("https://news.example.com/story"), "https://news.example.com/story");
});

test("rating labels use the published editorial thresholds and invalid entries are dropped", () => {
  assert.equal(editorialRatingLabel(80), "ALTO");
  assert.equal(editorialRatingLabel(60), "BUONO");
  assert.equal(editorialRatingLabel(40), "MEDIO");
  assert.equal(editorialRatingLabel(39), "BASSO");

  const results = normalizeNewsResults([
    { title: "No URL", editorialRating: { score: 80 } },
    { title: "Unsafe", url: "https://127.0.0.1/story", editorialRating: { score: 80 } },
    { title: "Valid", url: "https://example.com/story", editorialRating: { score: -20 } },
  ]);

  assert.equal(results.length, 1);
  assert.equal(results[0].editorialRating.score, 0);
  assert.equal(results[0].editorialRating.label, "BASSO");
});
