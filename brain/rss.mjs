import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { SOURCE_URL_ALLOWLIST } from "./source-catalog.mjs";

export const FEED_USER_AGENT =
  "MeiLingCreatorScout/0.1 (+local read-only feed monitor; no publishing)";
const FIXED_SOURCE_URL_ALLOWLIST = new Set(SOURCE_URL_ALLOWLIST);

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_XML_CHARS = 4 * 1024 * 1024;
const DEFAULT_MAX_DESCRIPTION_CHARS = 1_800;
const DEFAULT_MAX_ITEMS = 250;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/atom+xml",
  "application/rdf+xml",
  "application/rss+xml",
  "application/xml",
  "text/xml",
]);

const XML_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  copy: "©",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  trade: "™",
});

const TRACKING_PARAMETERS = new Set([
  "_hsenc",
  "_hsmi",
  "dclid",
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "oly_anon_id",
  "oly_enc_id",
  "si",
  "spm",
  "vero_conv",
  "vero_id",
]);

export class FeedFetchError extends Error {
  constructor(message, { code = "FEED_FETCH_FAILED", cause, status } = {}) {
    super(message, { cause });
    this.name = "FeedFetchError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localTagPattern(name) {
  const value = String(name);
  return value.includes(":")
    ? escapeRegExp(value)
    : `(?:[\\w.-]+:)?${escapeRegExp(value)}`;
}

function elementPattern(name, flags = "iu") {
  const tag = localTagPattern(name);
  return new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`, flags);
}

function extractElement(xml, names) {
  for (const name of Array.isArray(names) ? names : [names]) {
    const match = elementPattern(name).exec(xml);
    if (match) return { attributes: match[1] || "", inner: match[2] || "" };
  }
  return null;
}

function extractElements(xml, name, limit = Number.POSITIVE_INFINITY) {
  const matches = [];
  const pattern = elementPattern(name, "giu");
  for (const match of xml.matchAll(pattern)) {
    matches.push({ attributes: match[1] || "", inner: match[2] || "" });
    if (matches.length >= limit) break;
  }
  return matches;
}

function parseAttributes(value) {
  const attributes = {};
  const pattern = /([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
  for (const match of String(value || "").matchAll(pattern)) {
    attributes[match[1].toLocaleLowerCase()] = decodeXmlEntities(
      match[2] ?? match[3] ?? "",
    );
  }
  return attributes;
}

function firstCleanText(xml, names, options) {
  const element = extractElement(xml, names);
  return element ? cleanXmlText(element.inner, options) : "";
}

function normalizeDate(value) {
  const clean = cleanXmlText(value, { maxLength: 200 });
  if (!clean) return null;
  const timestamp = Date.parse(clean);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, Math.floor(parsed)))
    : fallback;
}

export function decodeXmlEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/giu, (match, digits) => {
      try {
        const point = Number.parseInt(digits, 16);
        return point >= 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : "\uFFFD";
      } catch {
        return match;
      }
    })
    .replace(/&#([0-9]+);/gu, (match, digits) => {
      try {
        const point = Number.parseInt(digits, 10);
        return point >= 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : "\uFFFD";
      } catch {
        return match;
      }
    })
    .replace(/&([a-z][a-z0-9]+);/giu, (match, name) => {
      return XML_ENTITIES[name.toLocaleLowerCase()] ?? match;
    });
}

export function cleanXmlText(
  value,
  { maxLength = DEFAULT_MAX_DESCRIPTION_CHARS } = {},
) {
  const boundedLength = boundedInteger(
    maxLength,
    DEFAULT_MAX_DESCRIPTION_CHARS,
    1,
    100_000,
  );
  let text = String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/giu, "$1")
    .replace(/<!--[\s\S]*?-->/gu, " ");

  text = decodeXmlEntities(text)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ")
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/giu, " ")
    .replace(/<[^>]+>/gu, " ");

  text = decodeXmlEntities(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (text.length <= boundedLength) return text;
  return `${text.slice(0, Math.max(1, boundedLength - 1)).trimEnd()}…`;
}

export function canonicalizeUrl(value, baseUrl) {
  const candidate = decodeXmlEntities(value).trim();
  if (!candidate) return null;

  let url;
  try {
    url = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol)) return null;
  if (url.username || url.password) return null;

  url.hash = "";
  url.hostname = url.hostname.toLocaleLowerCase();

  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLocaleLowerCase();
    if (
      lower.startsWith("utm_") ||
      lower.startsWith("pk_") ||
      TRACKING_PARAMETERS.has(lower)
    ) {
      url.searchParams.delete(key);
    }
  }

  const sortedEntries = [...url.searchParams.entries()].sort(([keyA, valueA], [keyB, valueB]) => {
    const keyOrder = keyA.localeCompare(keyB);
    return keyOrder || valueA.localeCompare(valueB);
  });
  url.search = "";
  for (const [key, entryValue] of sortedEntries) {
    url.searchParams.append(key, entryValue);
  }

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  }
  return url.toString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  if (typeof value === "string") {
    return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  }
  return value ?? null;
}

export function hashContent(value) {
  const serialized =
    typeof value === "string"
      ? stableValue(value)
      : JSON.stringify(stableValue(value));
  return createHash("sha256").update(String(serialized), "utf8").digest("hex");
}

export function hashFeedItem(item) {
  return hashContent({
    title: item?.title || "",
    url: item?.canonicalUrl || canonicalizeUrl(item?.url) || "",
    summary: item?.summary || "",
    published: item?.published || "",
    updated: item?.updated || "",
  });
}

function richerItem(first, second) {
  const firstRichness =
    String(first?.title || "").length +
    String(first?.summary || "").length +
    (first?.author ? 30 : 0);
  const secondRichness =
    String(second?.title || "").length +
    String(second?.summary || "").length +
    (second?.author ? 30 : 0);
  const preferred = secondRichness > firstRichness ? second : first;
  const fallback = preferred === first ? second : first;

  return {
    ...fallback,
    ...preferred,
    categories: [
      ...new Set([...(first?.categories || []), ...(second?.categories || [])]),
    ],
  };
}

export function dedupeFeedItems(items) {
  const unique = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const canonicalUrl =
      item.canonicalUrl || canonicalizeUrl(item.url) || null;
    const id = cleanXmlText(item.id || "", { maxLength: 500 });
    const key = canonicalUrl
      ? `url:${canonicalUrl}`
      : id
        ? `id:${id}`
        : `hash:${hashFeedItem(item)}`;
    const normalized = {
      ...item,
      canonicalUrl,
      contentHash: item.contentHash || hashFeedItem({ ...item, canonicalUrl }),
    };
    unique.set(
      key,
      unique.has(key) ? richerItem(unique.get(key), normalized) : normalized,
    );
  }
  return [...unique.values()];
}

function atomLink(block, baseUrl) {
  const pattern = /<(?:[\w.-]+:)?link\b([^>]*)\/?>/giu;
  const candidates = [];
  for (const match of block.matchAll(pattern)) {
    const attributes = parseAttributes(match[1]);
    const href = canonicalizeUrl(attributes.href, baseUrl);
    if (!href) continue;
    const rel = (attributes.rel || "alternate").toLocaleLowerCase();
    candidates.push({ href, rel, type: attributes.type || "" });
  }
  return (
    candidates.find((candidate) => candidate.rel === "alternate")?.href ||
    candidates.find((candidate) => !candidate.rel)?.href ||
    candidates[0]?.href ||
    null
  );
}

function rssLink(block, baseUrl) {
  const linkText = firstCleanText(block, "link", { maxLength: 4_000 });
  const link = canonicalizeUrl(linkText, baseUrl);
  if (link) return link;

  const guid = extractElement(block, "guid");
  if (!guid) return null;
  const attributes = parseAttributes(guid.attributes);
  if (attributes.ispermalink?.toLocaleLowerCase() === "false") return null;
  return canonicalizeUrl(cleanXmlText(guid.inner, { maxLength: 4_000 }), baseUrl);
}

function parseCategories(block) {
  const values = [];
  for (const element of extractElements(block, "category", 20)) {
    const attributes = parseAttributes(element.attributes);
    const value =
      attributes.term || cleanXmlText(element.inner, { maxLength: 200 });
    if (value) values.push(value);
  }
  const selfClosingPattern =
    /<(?:[\w.-]+:)?category\b([^>]*)\/\s*>/giu;
  for (const match of block.matchAll(selfClosingPattern)) {
    const value = parseAttributes(match[1]).term;
    if (value) values.push(value);
    if (values.length >= 20) break;
  }
  return [...new Set(values)].slice(0, 12);
}

function parseAuthor(block) {
  const author = extractElement(block, "author");
  if (author) {
    const name = firstCleanText(author.inner, "name", { maxLength: 300 });
    const direct = cleanXmlText(author.inner, { maxLength: 300 });
    if (name || direct) return name || direct;
  }
  return firstCleanText(block, ["dc:creator", "creator"], { maxLength: 300 }) || null;
}

function parseItem(block, type, options) {
  const { baseUrl, sourceId, maxDescriptionChars } = options;
  const title = firstCleanText(block, "title", { maxLength: 600 });
  const url =
    type === "atom" ? atomLink(block, baseUrl) : rssLink(block, baseUrl);
  const explicitId = firstCleanText(
    block,
    type === "atom" ? "id" : "guid",
    { maxLength: 1_000 },
  );

  const summaryElement =
    extractElement(block, type === "atom" ? "summary" : "description") ||
    extractElement(block, type === "atom" ? "content" : "content:encoded");
  const summary = summaryElement
    ? cleanXmlText(summaryElement.inner, { maxLength: maxDescriptionChars })
    : "";

  const publishedElement = extractElement(
    block,
    type === "atom" ? ["published", "updated"] : ["pubDate", "dc:date", "date"],
  );
  const updatedElement = extractElement(block, "updated");
  const published = normalizeDate(publishedElement?.inner || "");
  const updated = normalizeDate(updatedElement?.inner || "") || published;

  const item = {
    id: explicitId || url || "",
    title,
    url,
    canonicalUrl: url,
    summary,
    author: parseAuthor(block),
    categories: parseCategories(block),
    published,
    updated,
    sourceId: sourceId || null,
  };
  item.contentHash = hashFeedItem(item);
  if (!item.id) item.id = item.contentHash;
  return item;
}

export function parseFeedXml(
  xml,
  {
    sourceUrl,
    sourceId = null,
    maxDescriptionChars = DEFAULT_MAX_DESCRIPTION_CHARS,
    maxItems = DEFAULT_MAX_ITEMS,
    maxXmlChars = DEFAULT_MAX_XML_CHARS,
  } = {},
) {
  if (typeof xml !== "string") throw new TypeError("Feed XML must be a string");
  const boundedXmlChars = boundedInteger(
    maxXmlChars,
    DEFAULT_MAX_XML_CHARS,
    1_024,
    20 * 1024 * 1024,
  );
  if (xml.length > boundedXmlChars) {
    throw new RangeError(`Feed XML exceeds ${boundedXmlChars} characters`);
  }
  const document = xml.replace(/^\uFEFF/u, "").trim();
  if (!document) throw new TypeError("Feed XML must not be empty");

  const isAtom = /<(?:[\w.-]+:)?feed\b/iu.test(document);
  const isRss =
    /<(?:[\w.-]+:)?(?:rss|rdf)\b/iu.test(document) ||
    /<(?:[\w.-]+:)?channel\b/iu.test(document);
  if (!isAtom && !isRss) {
    throw new TypeError("Unsupported feed XML: expected RSS 2.0, RSS/RDF, or Atom");
  }

  const type = isAtom ? "atom" : "rss";
  const entryName = isAtom ? "entry" : "item";
  const boundedItems = boundedInteger(maxItems, DEFAULT_MAX_ITEMS, 1, 2_000);
  const entries = extractElements(document, entryName, boundedItems);
  const metadataXml = document.replace(elementPattern(entryName, "giu"), " ");
  const feedUrl =
    (isAtom
      ? atomLink(metadataXml, sourceUrl)
      : rssLink(metadataXml, sourceUrl)) ||
    canonicalizeUrl(sourceUrl);
  const baseUrl = feedUrl || canonicalizeUrl(sourceUrl) || sourceUrl;

  const descriptionElement = extractElement(
    metadataXml,
    isAtom ? ["subtitle", "tagline"] : "description",
  );
  const updatedElement = extractElement(
    metadataXml,
    isAtom ? "updated" : ["lastBuildDate", "pubDate", "dc:date"],
  );
  const items = entries
    .map(({ inner }) =>
      parseItem(inner, type, {
        baseUrl,
        sourceId,
        maxDescriptionChars,
      }),
    )
    .filter((item) => item.title || item.url);

  return {
    type,
    title: firstCleanText(metadataXml, "title", { maxLength: 600 }),
    description: descriptionElement
      ? cleanXmlText(descriptionElement.inner, {
          maxLength: maxDescriptionChars,
        })
      : "",
    url: feedUrl,
    updated: normalizeDate(updatedElement?.inner || ""),
    items: dedupeFeedItems(items),
  };
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("it")
    .replace(/[’']/gu, "'")
    .replace(/[^\p{L}\p{N}+#'.-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function includesKeyword(field, keyword) {
  if (!field || !keyword) return false;
  const wordCharacter = /[\p{L}\p{N}]/u;
  let offset = 0;
  while (offset <= field.length - keyword.length) {
    const index = field.indexOf(keyword, offset);
    if (index < 0) return false;
    const before = index > 0 ? field[index - 1] : "";
    const after =
      index + keyword.length < field.length
        ? field[index + keyword.length]
        : "";
    if (
      (!before || !wordCharacter.test(before)) &&
      (!after || !wordCharacter.test(after))
    ) {
      return true;
    }
    offset = index + 1;
  }
  return false;
}

export function scoreItemRelevance(item, profile = []) {
  const fields = {
    title: normalizeSearchText(item?.title),
    summary: normalizeSearchText(item?.summary),
    categories: normalizeSearchText((item?.categories || []).join(" ")),
  };
  const reasons = [];

  for (const group of Array.isArray(profile) ? profile : []) {
    const weight = Math.max(0, Number(group?.weight) || 1);
    const matches = [];
    const matchedFields = new Set();
    let rawScore = 0;

    for (const originalKeyword of group?.keywords || []) {
      const keyword = normalizeSearchText(originalKeyword);
      if (!keyword) continue;
      const fieldsForKeyword = [];
      if (includesKeyword(fields.title, keyword)) {
        rawScore += 4;
        fieldsForKeyword.push("title");
      }
      if (includesKeyword(fields.categories, keyword)) {
        rawScore += 2.25;
        fieldsForKeyword.push("categories");
      }
      if (includesKeyword(fields.summary, keyword)) {
        rawScore += 1.25;
        fieldsForKeyword.push("summary");
      }
      if (fieldsForKeyword.length) {
        matches.push(String(originalKeyword));
        for (const field of fieldsForKeyword) matchedFields.add(field);
      }
    }

    if (!matches.length) continue;
    const contribution = Math.min(18, rawScore * weight);
    const fieldLabels = [...matchedFields].map((field) => {
      if (field === "title") return "titolo";
      if (field === "categories") return "categorie";
      return "descrizione";
    });
    reasons.push({
      id: String(group.id || group.label || "interest"),
      label: String(group.label || group.id || "Interesse"),
      score: Number(contribution.toFixed(2)),
      keywords: [...new Set(matches)],
      fields: [...matchedFields],
      reason: `${group.label || group.id || "Interesse"}: ${[
        ...new Set(matches),
      ].join(", ")} (${fieldLabels.join(", ")})`,
    });
  }

  reasons.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const score = Math.min(
    100,
    Number(reasons.reduce((total, reason) => total + reason.score, 0).toFixed(2)),
  );
  return {
    score,
    relevant: score >= 4,
    reasons,
    matchedKeywords: [...new Set(reasons.flatMap((reason) => reason.keywords))],
  };
}

function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "");
}

function isPrivateOrReservedIpv4(address) {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateOrReservedIp(address) {
  const clean = normalizeHostname(address);
  const family = isIP(clean);
  if (family === 4) return isPrivateOrReservedIpv4(clean);
  if (family !== 6) return false;

  const ipv4Tail = (() => {
    if (!clean.includes(".")) return null;
    const candidate = clean.slice(clean.lastIndexOf(":") + 1);
    return isIP(candidate) === 4 ? candidate : null;
  })();
  if (ipv4Tail && clean.includes("ffff:")) {
    return isPrivateOrReservedIpv4(ipv4Tail);
  }
  const mappedHex = /(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(
    clean,
  );
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    const mappedIpv4 = [
      high >> 8,
      high & 0xff,
      low >> 8,
      low & 0xff,
    ].join(".");
    return isPrivateOrReservedIpv4(mappedIpv4);
  }
  return (
    clean === "::" ||
    clean === "::1" ||
    /^(?:fc|fd)[0-9a-f]{2}:/u.test(clean) ||
    /^fe[89ab][0-9a-f]:/u.test(clean) ||
    /^2001:db8:/u.test(clean) ||
    /^ff[0-9a-f]{2}:/u.test(clean)
  );
}

export function assertSafePublicFeedUrl(value) {
  let url;
  try {
    url = value instanceof URL ? new URL(value) : new URL(String(value));
  } catch (cause) {
    throw new FeedFetchError("Feed URL is invalid", {
      code: "INVALID_FEED_URL",
      cause,
    });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new FeedFetchError("Feed URL must use public HTTP or HTTPS", {
      code: "UNSAFE_FEED_URL",
    });
  }
  if (url.username || url.password) {
    throw new FeedFetchError("Feed URL must not contain credentials", {
      code: "UNSAFE_FEED_URL",
    });
  }

  const hostname = normalizeHostname(url.hostname);
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa") ||
    (isIP(hostname) && isPrivateOrReservedIp(hostname))
  ) {
    throw new FeedFetchError("Feed URL must resolve to a public host", {
      code: "UNSAFE_FEED_URL",
    });
  }
  return url;
}

async function assertPublicDnsResolution(url) {
  if (isIP(normalizeHostname(url.hostname))) return;
  let addresses;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch (cause) {
    throw new FeedFetchError(`Could not resolve feed host: ${url.hostname}`, {
      code: "FEED_DNS_FAILED",
      cause,
    });
  }
  if (
    !addresses.length ||
    addresses.some(({ address }) => isPrivateOrReservedIp(address))
  ) {
    throw new FeedFetchError("Feed host resolved to a non-public address", {
      code: "UNSAFE_FEED_URL",
    });
  }
}

function normalizeAllowedUrls(allowedUrls) {
  const source =
    allowedUrls === undefined ? FIXED_SOURCE_URL_ALLOWLIST : allowedUrls;
  return new Set(
    [...source].map((url) => {
      try {
        return new URL(String(url)).toString();
      } catch {
        return "";
      }
    }),
  );
}

function headerMetadata(headers) {
  return {
    etag: headers.get("etag") || null,
    lastModified: headers.get("last-modified") || null,
  };
}

function detectedEncoding(buffer, contentType) {
  const contentTypeCharset = /charset\s*=\s*["']?([^;"'\s]+)/iu.exec(
    contentType,
  )?.[1];
  const declaration = buffer
    .subarray(0, Math.min(buffer.length, 300))
    .toString("ascii");
  const xmlCharset = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/iu.exec(
    declaration,
  )?.[1];
  return contentTypeCharset || xmlCharset || "utf-8";
}

function decodeFeedBytes(buffer, contentType) {
  const encoding = detectedEncoding(buffer, contentType);
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  }
}

export async function fetchFeed(
  sourceOrUrl,
  {
    timeoutMs = 12_000,
    maxBytes = DEFAULT_MAX_BYTES,
    maxDescriptionChars = DEFAULT_MAX_DESCRIPTION_CHARS,
    etag,
    lastModified,
    signal,
    allowedUrls,
    allowUncatalogued = false,
    maxRedirects = 4,
  } = {},
) {
  const source =
    sourceOrUrl && typeof sourceOrUrl === "object" && !(sourceOrUrl instanceof URL)
      ? sourceOrUrl
      : null;
  const initialUrl = assertSafePublicFeedUrl(source?.url || sourceOrUrl);
  const allowlist = normalizeAllowedUrls(allowedUrls);
  if (!allowUncatalogued && !allowlist.has(initialUrl.toString())) {
    throw new FeedFetchError("Feed URL is not in Mei Ling's source catalog", {
      code: "FEED_NOT_ALLOWLISTED",
    });
  }

  const boundedTimeout = boundedInteger(timeoutMs, 12_000, 500, 60_000);
  const boundedBytes = boundedInteger(
    maxBytes,
    DEFAULT_MAX_BYTES,
    1_024,
    10 * 1024 * 1024,
  );
  const boundedRedirects = boundedInteger(maxRedirects, 4, 0, 8);
  const controller = new AbortController();
  const abortFromCaller = () =>
    controller.abort(signal?.reason || new Error("Feed fetch aborted"));
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Feed fetch timed out")),
    boundedTimeout,
  );

  const headers = {
    Accept:
      "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
    "Cache-Control": "no-cache",
    "User-Agent": FEED_USER_AGENT,
  };
  if (etag) headers["If-None-Match"] = String(etag);
  if (lastModified) headers["If-Modified-Since"] = String(lastModified);

  let currentUrl = initialUrl;
  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      await assertPublicDnsResolution(currentUrl);
      const response = await fetch(currentUrl, {
        method: "GET",
        headers,
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      const metadata = headerMetadata(response.headers);

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount >= boundedRedirects) {
          throw new FeedFetchError("Feed exceeded the redirect limit", {
            code: "TOO_MANY_REDIRECTS",
            status: response.status,
          });
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new FeedFetchError("Feed redirect has no location", {
            code: "INVALID_REDIRECT",
            status: response.status,
          });
        }
        await response.body?.cancel();
        currentUrl = assertSafePublicFeedUrl(new URL(location, currentUrl));
        continue;
      }

      if (response.status === 304) {
        return {
          status: 304,
          notModified: true,
          ...metadata,
          finalUrl: currentUrl.toString(),
          feed: null,
          xml: null,
        };
      }
      if (!response.ok) {
        throw new FeedFetchError(`Feed returned HTTP ${response.status}`, {
          code: "FEED_HTTP_ERROR",
          status: response.status,
        });
      }

      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLocaleLowerCase();
      if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
        throw new FeedFetchError(
          `Feed returned unsupported content type: ${contentType || "missing"}`,
          { code: "UNSUPPORTED_CONTENT_TYPE", status: response.status },
        );
      }

      const announcedLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(announcedLength) && announcedLength > boundedBytes) {
        throw new FeedFetchError(`Feed exceeds ${boundedBytes} bytes`, {
          code: "FEED_TOO_LARGE",
          status: response.status,
        });
      }
      if (!response.body) {
        throw new FeedFetchError("Feed response has no body", {
          code: "EMPTY_FEED",
          status: response.status,
        });
      }

      const chunks = [];
      let totalBytes = 0;
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        totalBytes += bytes.length;
        if (totalBytes > boundedBytes) {
          controller.abort(new Error("Feed exceeded the byte limit"));
          throw new FeedFetchError(`Feed exceeds ${boundedBytes} bytes`, {
            code: "FEED_TOO_LARGE",
            status: response.status,
          });
        }
        chunks.push(bytes);
      }

      const xml = decodeFeedBytes(Buffer.concat(chunks), contentType);
      const feed = parseFeedXml(xml, {
        sourceUrl: currentUrl.toString(),
        sourceId: source?.id || null,
        maxDescriptionChars,
      });
      return {
        status: response.status,
        notModified: false,
        ...metadata,
        finalUrl: currentUrl.toString(),
        feed,
        xml,
      };
    }
  } catch (error) {
    if (error instanceof FeedFetchError) throw error;
    if (controller.signal.aborted) {
      throw new FeedFetchError("Feed fetch was aborted or timed out", {
        code: "FEED_TIMEOUT_OR_ABORT",
        cause: error,
      });
    }
    throw new FeedFetchError("Feed fetch failed", {
      code: "FEED_FETCH_FAILED",
      cause: error,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
