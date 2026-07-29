import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_NEWS_QUERIES,
  MIURA_RELEVANCE_PROFILE,
  OFFICIAL_FEEDS,
  SOURCE_CATALOG,
  SOURCE_URL_ALLOWLIST,
  buildGoogleNewsRssUrl,
} from "./source-catalog.mjs";
import {
  FeedFetchError,
  assertSafePublicFeedUrl,
  canonicalizeUrl,
  cleanXmlText,
  decodeXmlEntities,
  dedupeFeedItems,
  fetchFeed,
  hashContent,
  hashFeedItem,
  parseFeedXml,
  scoreItemRelevance,
} from "./rss.mjs";

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Studio &amp; News</title>
    <link>https://example.com/news/</link>
    <description><![CDATA[Official <b>updates</b> &amp; notes.]]></description>
    <lastBuildDate>Wed, 29 Jul 2026 08:00:00 GMT</lastBuildDate>
    <item>
      <title><![CDATA[Silent Hill: Townfall — nuovo trailer]]></title>
      <link>https://example.com/news/townfall/?utm_source=rss&amp;b=2&amp;a=1#video</link>
      <guid isPermaLink="true">https://example.com/news/townfall/</guid>
      <description><![CDATA[<p>Un nuovo sguardo al mistero.</p>]]></description>
      <content:encoded><![CDATA[<article>${"heavy ".repeat(2_000)}</article>]]></content:encoded>
      <dc:creator>Studio Team</dc:creator>
      <category>Psychological Horror</category>
      <pubDate>Wed, 29 Jul 2026 07:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Developer Journal</title>
  <subtitle>Games &amp; technology</subtitle>
  <link href="https://studio.example/blog/" rel="alternate"/>
  <updated>2026-07-29T09:00:00Z</updated>
  <entry>
    <title>FromSoftware announces a new project</title>
    <id>tag:studio.example,2026:new-project</id>
    <link rel="alternate" href="/blog/new-project?utm_medium=feed"/>
    <summary type="html">&lt;p&gt;An ambitious action RPG from the studio.&lt;/p&gt;</summary>
    <author><name>News Room</name></author>
    <category term="Action RPG"/>
    <published>2026-07-29T08:15:00+00:00</published>
    <updated>2026-07-29T08:30:00+00:00</updated>
  </entry>
</feed>`;

test("XML text cleanup handles named/numeric entities, CDATA, and HTML", () => {
  assert.equal(
    decodeXmlEntities("A &amp; B &#x2014; &#169; &unknown;"),
    "A & B — © &unknown;",
  );
  assert.equal(
    cleanXmlText("<![CDATA[<p>Hello&nbsp; <b>Miura</b></p>]]>"),
    "Hello Miura",
  );
  assert.equal(cleanXmlText("abcdefghij", { maxLength: 6 }), "abcde…");
});

test("RSS 2.0 parser extracts bounded normalized items without heavy content", () => {
  const feed = parseFeedXml(RSS_FIXTURE, {
    sourceUrl: "https://example.com/feed.xml",
    sourceId: "fixture-rss",
  });

  assert.equal(feed.type, "rss");
  assert.equal(feed.title, "Studio & News");
  assert.equal(feed.description, "Official updates & notes.");
  assert.equal(feed.url, "https://example.com/news");
  assert.equal(feed.updated, "2026-07-29T08:00:00.000Z");
  assert.equal(feed.items.length, 1);

  const [item] = feed.items;
  assert.equal(item.title, "Silent Hill: Townfall — nuovo trailer");
  assert.equal(
    item.canonicalUrl,
    "https://example.com/news/townfall?a=1&b=2",
  );
  assert.equal(item.summary, "Un nuovo sguardo al mistero.");
  assert.equal(item.author, "Studio Team");
  assert.deepEqual(item.categories, ["Psychological Horror"]);
  assert.equal(item.sourceId, "fixture-rss");
  assert.match(item.contentHash, /^[0-9a-f]{64}$/u);
  assert.ok(!item.summary.includes("heavy"));
});

test("Atom parser resolves relative links and reads author/category/date", () => {
  const feed = parseFeedXml(ATOM_FIXTURE, {
    sourceUrl: "https://studio.example/feed.atom",
    sourceId: "fixture-atom",
  });

  assert.equal(feed.type, "atom");
  assert.equal(feed.title, "Developer Journal");
  assert.equal(feed.description, "Games & technology");
  assert.equal(feed.url, "https://studio.example/blog");
  assert.equal(feed.items.length, 1);

  const [item] = feed.items;
  assert.equal(
    item.canonicalUrl,
    "https://studio.example/blog/new-project",
  );
  assert.equal(item.summary, "An ambitious action RPG from the studio.");
  assert.equal(item.author, "News Room");
  assert.deepEqual(item.categories, ["Action RPG"]);
  assert.equal(item.published, "2026-07-29T08:15:00.000Z");
  assert.equal(item.updated, "2026-07-29T08:30:00.000Z");
});

test("URL canonicalization, stable hashes, and dedupe remove tracking variants", () => {
  assert.equal(
    canonicalizeUrl(
      "HTTPS://Example.com:443/story/?utm_source=test&b=2&a=1#section",
    ),
    "https://example.com/story?a=1&b=2",
  );
  assert.equal(hashContent({ b: 2, a: 1 }), hashContent({ a: 1, b: 2 }));
  assert.equal(
    hashFeedItem({
      title: "A  title",
      summary: "Text",
      url: "https://example.com/story?utm_campaign=x",
    }),
    hashFeedItem({
      title: "A title",
      summary: "Text",
      canonicalUrl: "https://example.com/story",
    }),
  );

  const unique = dedupeFeedItems([
    {
      id: "first",
      title: "A story",
      summary: "Short",
      url: "https://example.com/story?utm_source=one",
      categories: ["Games"],
    },
    {
      id: "second",
      title: "A story",
      summary: "A much richer description",
      url: "https://example.com/story?fbclid=tracking",
      categories: ["Industry"],
    },
  ]);

  assert.equal(unique.length, 1);
  assert.equal(unique[0].canonicalUrl, "https://example.com/story");
  assert.equal(unique[0].summary, "A much richer description");
  assert.deepEqual(unique[0].categories, ["Games", "Industry"]);
});

test("Miura profile scoring returns weighted, explainable reasons", () => {
  const result = scoreItemRelevance(
    {
      title: "Silent Hill returns in a new FromSoftware-style experiment",
      summary:
        "The psychological horror project mixes an indie game structure with a new demo.",
      categories: ["Horror", "Indie"],
    },
    MIURA_RELEVANCE_PROFILE,
  );

  assert.equal(result.relevant, true);
  assert.ok(result.score >= 10);
  assert.ok(result.matchedKeywords.includes("Silent Hill"));
  assert.ok(result.matchedKeywords.includes("FromSoftware"));
  assert.ok(
    result.reasons.some(
      (reason) =>
        reason.id === "horror" &&
        reason.fields.includes("title") &&
        reason.reason.includes("Silent Hill"),
    ),
  );

  assert.deepEqual(
    scoreItemRelevance(
      { title: "Quarterly office furniture report", summary: "" },
      MIURA_RELEVANCE_PROFILE,
    ),
    { score: 0, relevant: false, reasons: [], matchedKeywords: [] },
  );
});

test("catalog is fixed, public, and includes official plus targeted sources", () => {
  assert.ok(
    OFFICIAL_FEEDS.some(
      (source) =>
        source.id === "playstation-blog" &&
        source.url === "https://blog.playstation.com/feed/",
    ),
  );
  assert.ok(OFFICIAL_FEEDS.length >= 2);
  assert.ok(GOOGLE_NEWS_QUERIES.length >= 4);
  assert.equal(SOURCE_CATALOG.length, SOURCE_URL_ALLOWLIST.size);
  assert.ok(
    GOOGLE_NEWS_QUERIES.every(
      (source) =>
        new URL(source.url).hostname === "news.google.com" && source.query,
    ),
  );
  assert.match(
    buildGoogleNewsRssUrl('"Hideo Kojima" when:1d'),
    /^https:\/\/news\.google\.com\/rss\/search\?/u,
  );
});

test("safe URL guard allows public HTTPS and rejects local/auth/non-HTTP URLs", () => {
  assert.equal(
    assertSafePublicFeedUrl("https://blog.playstation.com/feed/").hostname,
    "blog.playstation.com",
  );
  for (const unsafe of [
    "http://127.0.0.1:5178/feed",
    "http://10.0.0.8/feed",
    "http://[::1]/feed",
    "http://[::ffff:127.0.0.1]/feed",
    "http://user:password@example.com/feed",
    "file:///tmp/feed.xml",
  ]) {
    assert.throws(
      () => assertSafePublicFeedUrl(unsafe),
      (error) =>
        error instanceof FeedFetchError && error.code === "UNSAFE_FEED_URL",
    );
  }
});
test("fetchFeed rejects URLs outside the fixed catalog before network access", async () => {
  await assert.rejects(
    fetchFeed("https://example.com/not-in-the-catalog.xml"),
    (error) =>
      error instanceof FeedFetchError && error.code === "FEED_NOT_ALLOWLISTED",
  );
});