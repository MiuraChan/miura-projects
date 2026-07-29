/**
 * Read-only public news sources for Mei Ling's scouting loop.
 *
 * This is configuration only: inclusion in the catalog never means that a
 * source was reached, fetched, endorsed, or found to contain a current story.
 */

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function buildGoogleNewsRssUrl(
  query,
  { language = "it", region = "IT", edition = "IT:it" } = {},
) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) throw new TypeError("Google News query must not be empty");

  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", cleanQuery);
  url.searchParams.set("hl", language);
  url.searchParams.set("gl", region);
  url.searchParams.set("ceid", edition);
  return url.toString();
}

export const MIURA_RELEVANCE_PROFILE = deepFreeze([
  {
    id: "kojima-auteur",
    label: "Kojima e giochi d'autore",
    weight: 2.2,
    keywords: [
      "Hideo Kojima",
      "Kojima Productions",
      "Death Stranding",
      "Metal Gear",
      "OD",
      "Physint",
      "Fumito Ueda",
      "genDESIGN",
      "Yoko Taro",
      "NieR",
    ],
  },
  {
    id: "fromsoftware-souls",
    label: "FromSoftware e soulslike",
    weight: 2.1,
    keywords: [
      "FromSoftware",
      "Elden Ring",
      "Dark Souls",
      "Bloodborne",
      "Sekiro",
      "Armored Core",
      "Lies of P",
      "soulslike",
    ],
  },
  {
    id: "final-fantasy-rpg",
    label: "Final Fantasy, CRPG e ARPG",
    weight: 1.75,
    keywords: [
      "Final Fantasy",
      "FFXIV",
      "FF14",
      "Square Enix",
      "Baldur's Gate",
      "CRPG",
      "ARPG",
      "Dragon's Dogma",
      "Fallout",
      "Cyberpunk 2077",
    ],
  },
  {
    id: "indie-experimental",
    label: "Indie e sistemi insoliti",
    weight: 1.8,
    keywords: [
      "indie game",
      "indie games",
      "roguelike",
      "The Binding of Isaac",
      "Undertale",
      "Blue Prince",
      "Kenshi",
      "Dwarf Fortress",
      "Caves of Qud",
      "RimWorld",
      "Quasimorph",
      "SULFUR",
    ],
  },
  {
    id: "horror",
    label: "Horror e mistero psicologico",
    weight: 1.8,
    keywords: [
      "Silent Hill",
      "Resident Evil",
      "Alan Wake",
      "Control",
      "psychological horror",
      "horror psicologico",
      "Who's Lila",
    ],
  },
  {
    id: "strategy-simulation",
    label: "Strategia e simulazione",
    weight: 1.35,
    keywords: [
      "Total War Warhammer",
      "Warhammer 40,000",
      "Warhammer 40K",
      "Crusader Kings",
      "Stellaris",
      "Paradox Interactive",
      "Civilization",
      "Age of Wonders",
      "Conquest of Elysium",
    ],
  },
  {
    id: "coop-action",
    label: "Co-op e action",
    weight: 1.25,
    keywords: [
      "Borderlands",
      "Monster Hunter",
      "co-op",
      "cooperative",
      "multiplayer",
      "Palworld",
      "ARC Raiders",
      "PlatinumGames",
    ],
  },
  {
    id: "creator-industry",
    label: "Industria e opportunità creator",
    weight: 1.05,
    keywords: [
      "Twitch",
      "YouTube",
      "Instagram",
      "streaming",
      "creator program",
      "content creator",
      "game showcase",
      "demo",
      "early access",
      "release date",
    ],
  },
]);

export const OFFICIAL_FEEDS = deepFreeze([
  {
    id: "playstation-blog",
    name: "PlayStation Blog",
    kind: "rss",
    publisherType: "official",
    url: "https://blog.playstation.com/feed/",
    language: "en",
    topics: ["playstation", "releases", "developers", "industry"],
    enabled: true,
  },
  {
    id: "xbox-wire",
    name: "Xbox Wire",
    kind: "rss",
    publisherType: "official",
    url: "https://news.xbox.com/en-us/feed/",
    language: "en",
    topics: ["xbox", "pc", "game-pass", "releases", "industry"],
    enabled: true,
  },
  {
    id: "steam-news",
    name: "Steam News",
    kind: "rss",
    publisherType: "official",
    url: "https://store.steampowered.com/feeds/news.xml",
    language: "en",
    topics: ["pc", "steam", "releases", "updates"],
    enabled: true,
  },
  {
    id: "ffxiv-lodestone",
    name: "FINAL FANTASY XIV — The Lodestone",
    kind: "rss",
    publisherType: "official",
    url: "https://eu.finalfantasyxiv.com/lodestone/news/news.xml",
    language: "en",
    topics: ["final-fantasy", "ffxiv", "square-enix"],
    enabled: true,
  },
]);

const googleNewsQueryDefinitions = [
  {
    id: "google-kojima-auteur",
    name: "Google News — Kojima e autori",
    query:
      '("Hideo Kojima" OR "Kojima Productions" OR "Death Stranding" OR "Fumito Ueda" OR "Yoko Taro") when:7d',
    topics: ["kojima", "auteur", "nier", "fumito-ueda"],
  },
  {
    id: "google-fromsoftware",
    name: "Google News — FromSoftware e soulslike",
    query:
      '("FromSoftware" OR "Elden Ring" OR "Bloodborne" OR "Armored Core" OR soulslike) when:7d',
    topics: ["fromsoftware", "soulslike"],
  },
  {
    id: "google-rpg",
    name: "Google News — Final Fantasy, CRPG e ARPG",
    query:
      '("Final Fantasy" OR FFXIV OR CRPG OR ARPG OR "Baldur\'s Gate" OR "Dragon\'s Dogma") when:7d',
    topics: ["final-fantasy", "crpg", "arpg"],
  },
  {
    id: "google-indie-systems",
    name: "Google News — Indie e giochi sistemici",
    query:
      '("indie game" OR roguelike OR "Dwarf Fortress" OR RimWorld OR "Caves of Qud" OR Kenshi) when:7d',
    topics: ["indie", "roguelike", "simulation"],
  },
  {
    id: "google-horror",
    name: "Google News — Horror psicologico",
    query:
      '("Silent Hill" OR "Resident Evil" OR "Alan Wake" OR "psychological horror") when:7d',
    topics: ["horror", "silent-hill", "resident-evil"],
  },
  {
    id: "google-warhammer-strategy",
    name: "Google News — Warhammer e strategia",
    query:
      '("Warhammer 40K" OR "Total War Warhammer" OR Stellaris OR "Crusader Kings" OR Civilization) when:7d',
    topics: ["warhammer", "strategy", "paradox"],
  },
  {
    id: "google-coop-action",
    name: "Google News — Co-op e action",
    query:
      '("Borderlands" OR "Monster Hunter" OR "ARC Raiders" OR Palworld OR "PlatinumGames") when:7d',
    topics: ["coop", "action", "multiplayer"],
  },
];

export const GOOGLE_NEWS_QUERIES = deepFreeze(
  googleNewsQueryDefinitions.map((source) => ({
    ...source,
    kind: "google-news-rss",
    publisherType: "aggregator",
    url: buildGoogleNewsRssUrl(source.query),
    language: "it",
    enabled: true,
  })),
);

export const SOURCE_CATALOG = deepFreeze([
  ...OFFICIAL_FEEDS,
  ...GOOGLE_NEWS_QUERIES,
]);

export const SOURCE_URL_ALLOWLIST = new Set(
  SOURCE_CATALOG.filter((source) => source.enabled).map((source) => source.url),
);

export function getEnabledSources() {
  return SOURCE_CATALOG.filter((source) => source.enabled);
}

export function getSourceById(id) {
  return SOURCE_CATALOG.find((source) => source.id === id) || null;
}
