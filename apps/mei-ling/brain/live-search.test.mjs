import assert from "node:assert/strict";
import test from "node:test";
import {
  asksInternetCapability,
  buildEditorialRating,
  buildInternetCapabilityReply,
  buildLiveSearchReply,
  buildLiveSearchSpokenReply,
  extractSearchTopic,
  requestsLiveSearch,
  searchLivePublicNews,
} from "./live-search.mjs";

const NOW = new Date("2026-08-05T09:30:00.000Z");

test("live-search intent catches current and correction turns without hijacking ordinary today talk", () => {
  assert.equal(
    requestsLiveSearch("Quali sono le ultime news su Monster Hunter Wilds?"),
    true,
  );
  assert.equal(
    requestsLiveSearch("Hai sbagliato: ricominciamo da zero e cerca online quando è già uscito Monster Hunter Wilds."),
    true,
  );
  assert.equal(requestsLiveSearch("Monster Hunter Wilds è ancora in sviluppo?"), true);
  assert.equal(requestsLiveSearch("Oggi sto male e sono stanco."), false);
  assert.equal(requestsLiveSearch("Controlla il microfono."), false);
  assert.equal(requestsLiveSearch("Verifica il microfono."), false);
  assert.equal(requestsLiveSearch("cerca di capire cosa ho detto"), false);
  assert.equal(requestsLiveSearch("cerca di non ripeterti"), false);
  assert.equal(requestsLiveSearch("Puoi cercare online le news su Monster Hunter Wilds?"), true);
  assert.equal(requestsLiveSearch("Raccontami qualcosa di te."), false);
});

test("internet capability accepts natural and noisy Italian STT variants", () => {
  assert.equal(asksInternetCapability("Sei connessa a internet?"), true);
  assert.equal(asksInternetCapability("Voi connesti da internet?"), true);
  assert.equal(asksInternetCapability("Hai accesso al web?"), true);
  assert.equal(asksInternetCapability("Puoi cercare online?"), true);
  assert.equal(asksInternetCapability("Puoi cercare online le news su Monster Hunter Wilds?"), false);
  assert.equal(requestsLiveSearch("Sei connessa a internet?"), false);
});

test("search topic contains only the bounded subject rather than the whole correction transcript", () => {
  assert.equal(extractSearchTopic("Ciao mi dai le notizie di oggi"), "videogiochi");
  assert.equal(extractSearchTopic("ok cerca news gaming"), "videogiochi");
  assert.equal(
    extractSearchTopic("Mei Ling, hai sbagliato: ricominciamo da zero. Cerca online le novità su Monster Hunter Wilds, per favore."),
    "Monster Hunter Wilds",
  );
  assert.equal(
    extractSearchTopic("No, è già uscito: ricominciamo da zero e cerca online Monster Hunter Wilds"),
    "Monster Hunter Wilds",
  );
  assert.equal(
    extractSearchTopic("Hai sbagliato: ricominciamo da zero e cerca online quando è già uscito Monster Hunter Wilds"),
    "Monster Hunter Wilds",
  );
  assert.equal(
    extractSearchTopic("Puoi cercare online le news su Monster Hunter Wilds?"),
    "Monster Hunter Wilds",
  );
  assert.equal(
    extractSearchTopic("Monster Hunter Wilds è ancora in sviluppo? Cerca online e dammi le fonti."),
    "Monster Hunter Wilds",
  );
  const bounded = extractSearchTopic(`cerca news su ${"gioco ".repeat(40)}`);
  assert.ok(bounded.length <= 120);
  assert.ok(bounded.split(" ").length <= 14);
});

test("live search uses fixed Google News host and grounds every returned field", async () => {
  let sourceUrl = "";
  let receivedOptions;
  const search = await searchLivePublicNews(
    "Cerca le ultime news su Monster Hunter Wilds",
    {
      clock: () => NOW,
      fetchFeedImpl: async (source, options) => {
        sourceUrl = source.url;
        receivedOptions = options;
        return {
          feed: {
            items: [
              {
                title: "Monster Hunter Wilds riceve un aggiornamento - Capcom",
                canonicalUrl: "https://news.google.com/rss/articles/example-one",
                published: "2026-08-05T08:00:00.000Z",
              },
              {
                title: "Analisi delle prestazioni di Wilds - Digital Foundry",
                canonicalUrl: "https://news.google.com/rss/articles/example-two",
                published: "2026-08-04T15:00:00.000Z",
              },
            ],
          },
        };
      },
    },
  );

  const parsedUrl = new URL(sourceUrl);
  assert.equal(parsedUrl.hostname, "news.google.com");
  assert.match(parsedUrl.searchParams.get("q"), /^Monster Hunter Wilds when:30d$/u);
  assert.equal(receivedOptions.allowUncatalogued, true);
  assert.deepEqual([...receivedOptions.allowedUrls], [sourceUrl]);
  assert.equal(search.ok, true);
  assert.equal(search.fetchedAt, NOW.toISOString());
  assert.equal(search.results[0].source, "Capcom");
  assert.equal(search.results[0].sourceTier, "aggregator");
  assert.equal(search.results[0].claimStatus, "unconfirmed");
  assert.equal(search.results[0].editorialRating.score, 88);
  assert.equal(search.results[0].editorialRating.label, "ALTO");
  assert.equal(search.results[0].editorialRating.model, "topic-freshness-source-v1");
  assert.equal(
    search.results[0].editorialRating.components.topicRelevance.score,
    100,
  );
  assert.equal(search.results[0].editorialRating.components.freshness.score, 100);
  assert.equal(
    search.results[0].editorialRating.components.sourceTraceability.score,
    40,
  );
  assert.equal(search.results[0].editorialRating.verificationRequired, true);
  assert.equal(search.results[1].editorialRating.components.topicRelevance.score, 28);
  assert.equal(search.results[1].editorialRating.score, 52);
  assert.equal(search.results[1].claimStatus, "unconfirmed");

  const reply = buildLiveSearchReply(search);
  assert.match(reply, /05\/08\/2026/u);
  assert.match(reply, /Monster Hunter Wilds riceve un aggiornamento/u);
  assert.match(reply, /fonte segnalata: Capcom/u);
  assert.match(reply, /rating editoriale: 88\/100 \(ALTO\)/u);
  assert.match(reply, /URL: https:\/\/news\.google\.com/u);
  assert.match(reply, /aggregatore.*non confermate/u);

  const spoken = buildLiveSearchSpokenReply(search);
  assert.match(spoken, /primo risultato/u);
  assert.match(spoken, /Capcom/u);
  assert.match(spoken, /data riportata dal feed/u);
  assert.match(spoken, /rating editoriale di 88 su 100/u);
  assert.match(spoken, /link sullo schermo/u);
  assert.doesNotMatch(spoken, /https?:\/\//u);
});

test("generic daily news searches globally and rejects gambling results", async () => {
  const calls = [];
  const search = await searchLivePublicNews("Ciao mi dai le notizie di oggi", {
    clock: () => NOW,
    fetchFeedImpl: async (source) => {
      calls.push(source.url);
      return {
        feed: {
          items: [
            {
              title: "Nuovo gioco indie annunciato su Steam - Rock Paper Shotgun",
              canonicalUrl: "https://news.google.com/rss/articles/game-one",
              published: "2026-08-05T08:00:00.000Z",
            },
            {
              title: "Lottomatica: cresce il mercato delle scommesse - Economia Oggi",
              canonicalUrl: "https://news.google.com/rss/articles/betting-one",
              published: "2026-08-05T08:00:00.000Z",
            },
          ],
        },
      };
    },
  });
  assert.equal(calls.length, 8);
  assert.equal(search.query, "videogiochi");
  assert.deepEqual(search.searchedEditions, ["it", "en-us", "en-gb", "ja", "es", "fr", "de", "pt-br"]);
  assert.equal(search.results.length, 1);
  assert.match(search.results[0].title, /gioco indie/iu);
  assert.doesNotMatch(search.results.map((item) => item.title).join(" "), /Lottomatica/iu);
});

test("global results prefer language diversity before filling duplicate languages", async () => {
  const search = await searchLivePublicNews("news videogiochi", {
    clock: () => NOW,
    fetchFeedImpl: async (source) => {
      const edition = new URL(source.url).searchParams.get("ceid");
      const language = new URL(source.url).searchParams.get("hl");
      return {
        feed: {
          items: [{
            title: `Video games industry update ${edition} - Gaming Editorial ${language}`,
            canonicalUrl: `https://news.google.com/rss/articles/${encodeURIComponent(edition)}`,
            published: "2026-08-05T09:00:00.000Z",
          }],
        },
      };
    },
  });
  assert.deepEqual(search.results.map((item) => item.language), ["it", "en-US", "ja"]);
});

test("Japanese sports uses of game do not pass the videogame editorial gate", async () => {
  const search = await searchLivePublicNews("news videogiochi", {
    clock: () => NOW,
    fetchFeedImpl: async () => ({
      feed: { items: [{
        title: "2026-27シーズン プレシーズンゲーム こども招待企画 - アルバルク東京",
        canonicalUrl: "https://news.google.com/rss/articles/sports-game",
        published: "2026-08-05T09:00:00.000Z",
      }] },
    }),
  });
  assert.deepEqual(search.results, []);
});

test("general-interest publishers are excluded even when an article mentions videogames", async () => {
  const search = await searchLivePublicNews("news videogiochi", {
    clock: () => NOW,
    fetchFeedImpl: async () => ({
      feed: { items: [{
        title: "Il mercato dei videogiochi cresce - Quotidiano Generalista",
        canonicalUrl: "https://news.google.com/rss/articles/general-news",
        published: "2026-08-05T09:00:00.000Z",
      }] },
    }),
  });
  assert.deepEqual(search.results, []);
});

test("editorial rating is transparent about missing and anomalous feed dates", () => {
  const base = {
    title: "Monster Hunter Wilds riceve un aggiornamento",
    sourceTier: "aggregator",
  };
  const options = {
    topic: "Monster Hunter Wilds",
    fetchedAt: NOW.toISOString(),
    sourceTier: "aggregator",
  };
  const missing = buildEditorialRating({ ...base, publishedAt: null }, options);
  assert.equal(missing.score, 58);
  assert.equal(missing.label, "MEDIO");
  assert.equal(missing.components.freshness.score, 0);
  assert.equal(missing.components.freshness.ageHours, null);
  assert.match(missing.reasons.join(" "), /data non disponibile nel feed/u);
  assert.equal(missing.verificationRequired, true);

  const future = buildEditorialRating({
    ...base,
    publishedAt: "2026-08-05T16:30:01.000Z",
  }, options);
  assert.equal(future.score, 58);
  assert.equal(future.components.freshness.score, 0);
  assert.equal(future.components.freshness.anomaly, "future-date");
  assert.match(future.reasons.join(" "), /data del feed anomala/u);
  assert.equal(future.verificationRequired, true);
});

test("a high aggregator rating never upgrades the claim to confirmed", async () => {
  const search = await searchLivePublicNews("news Monster Hunter Wilds", {
    clock: () => NOW,
    fetchFeedImpl: async () => ({
      feed: {
        items: [{
          title: "Monster Hunter Wilds - Capcom",
          canonicalUrl: "https://news.google.com/rss/articles/high-rating",
          published: "2026-08-05T09:00:00.000Z",
          claimStatus: "confirmed",
        }],
      },
    }),
  });
  assert.equal(search.results[0].editorialRating.score, 88);
  assert.equal(search.results[0].editorialRating.label, "ALTO");
  assert.equal(search.results[0].editorialRating.verificationRequired, true);
  assert.equal(search.results[0].claimStatus, "unconfirmed");
  assert.equal(search.claimStatus, "unconfirmed");
});

test("network failure and disabled search are explicit and never use model memory", async () => {
  const failed = await searchLivePublicNews("verifica Monster Hunter Wilds", {
    clock: () => NOW,
    fetchFeedImpl: async () => {
      const error = new Error("mock network failure");
      error.code = "FEED_FETCH_FAILED";
      throw error;
    },
  });
  assert.equal(failed.status, "unreachable");
  assert.equal(failed.errorCode, "FEED_FETCH_FAILED");
  assert.match(buildLiveSearchReply(failed), /non è raggiungibile/u);
  assert.match(buildLiveSearchReply(failed), /memoria del modello/u);

  const disabled = await searchLivePublicNews("news Monster Hunter", {
    enabled: false,
    clock: () => NOW,
    fetchFeedImpl: async () => assert.fail("disabled search must not fetch"),
  });
  assert.equal(disabled.status, "disabled");
  assert.match(buildLiveSearchReply(disabled), /non è attiva/u);
});

test("internet capability truthfully distinguishes a successful probe from an outage", () => {
  const connected = buildInternetCapabilityReply({
    ok: true,
    status: "results",
    fetchedAt: NOW.toISOString(),
  }, { schedulerEnabled: true });
  assert.match(connected, /ho raggiunto Google News/u);
  assert.match(connected, /Daily Intel automatico è attivo/u);

  const unavailable = buildInternetCapabilityReply({
    ok: false,
    status: "unreachable",
    fetchedAt: NOW.toISOString(),
  }, { schedulerEnabled: false });
  assert.match(unavailable, /non posso dichiararmi connessa/u);
  assert.match(unavailable, /Daily Intel automatico è disattivato/u);
});
