const BASE_URL = "https://nyaa.si";
const MAX_RESULTS = 20;
const TRACKERS = [
  "udp://open.stealth.si:80/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://exodus.desync.com:6969/announce",
];

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeEntities(value) {
  return cleanText(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, value) => String.fromCharCode(Number(value)))
    .trim();
}

function stripTags(value) {
  return decodeEntities(cleanText(value).replace(/<[^>]*>/g, ""));
}

function xmlTag(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function parseCount(value) {
  const parsed = Number.parseInt(cleanText(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseSizeBytes(value) {
  const match = cleanText(value).match(/^([0-9]+(?:\.[0-9]+)?)\s*(B|KiB|MiB|GiB|TiB)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const powers = { b: 0, kib: 1, mib: 2, gib: 3, tib: 4 };
  const power = powers[match[2].toLowerCase()];
  return Math.round(amount * (1024 ** power));
}

function categoryFor(preferredLanguages) {
  const languages = Array.from(preferredLanguages ?? [])
    .map((value) => cleanText(value).toLowerCase())
    .filter(Boolean);
  if (languages.length > 0 && languages.every((value) => value === "en" || value.startsWith("en-"))) {
    return "3_1";
  }
  if (languages.length > 0 && languages.every((value) => value === "ja" || value.startsWith("ja-"))) {
    return "3_3";
  }
  return "3_0";
}

function languagesForCategory(category) {
  const normalized = cleanText(category).toLowerCase();
  if (normalized.includes("english")) return ["en"];
  if (normalized.includes("raw")) return ["ja"];
  return [];
}

function validNyaaUrl(value, expectedPrefix) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "nyaa.si" && parsed.pathname.startsWith(expectedPrefix);
  } catch (_error) {
    return false;
  }
}

function magnetFor(infoHash, displayName) {
  const params = [
    `xt=urn:btih:${infoHash}`,
    `dn=${encodeURIComponent(displayName)}`,
    ...TRACKERS.map((tracker) => `tr=${encodeURIComponent(tracker)}`),
  ];
  return `magnet:?${params.join("&")}`;
}

async function httpText(url, accept) {
  const responseJson = await globalThis.tsuzuki.http.request(
    "GET",
    url,
    JSON.stringify({ Accept: accept }),
  );
  const response = JSON.parse(responseJson);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Nyaa request failed with HTTP ${response.statusCode}`);
  }
  return String(response.body ?? "");
}

function parseSearchFeed(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const items = [];
  const seen = new Set();

  for (const block of blocks) {
    const infoHash = xmlTag(block, "nyaa:infoHash").toLowerCase();
    const displayName = xmlTag(block, "title");
    const torrentUrl = xmlTag(block, "link");
    const detailUrl = xmlTag(block, "guid");
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(infoHash)) continue;
    if (!displayName || seen.has(infoHash)) continue;
    if (!validNyaaUrl(torrentUrl, "/download/")) continue;
    if (!validNyaaUrl(detailUrl, "/view/")) continue;

    seen.add(infoHash);
    items.push({
      infoHash,
      magnetUri: magnetFor(infoHash, displayName),
      torrentUrl,
      detailUrl,
      displayName,
      sizeBytes: parseSizeBytes(xmlTag(block, "nyaa:size")),
      seeders: parseCount(xmlTag(block, "nyaa:seeders")),
      peers: parseCount(xmlTag(block, "nyaa:leechers")),
      languages: languagesForCategory(xmlTag(block, "nyaa:category")),
    });
    if (items.length >= MAX_RESULTS) break;
  }

  return items;
}

function parseSingleArchive(html, languages) {
  if (/class=["'][^"']*\bfolder\b[^"']*["']/i.test(html)) return null;

  const fileMatches = Array.from(
    html.matchAll(/<li[^>]*>\s*<i[^>]*class=["'][^"']*\bfa-file\b[^"']*["'][^>]*><\/i>\s*([\s\S]*?)\s*<span[^>]*class=["'][^"']*\bfile-size\b[^"']*["'][^>]*>\(([^<]+)\)<\/span>\s*<\/li>/gi),
  );
  if (fileMatches.length !== 1) return null;

  const path = stripTags(fileMatches[0][1]);
  if (!path || path.includes("/") || path.includes("\\") || !/\.(?:cbz|zip)$/i.test(path)) return null;

  return {
    index: 0,
    path,
    sizeBytes: parseSizeBytes(fileMatches[0][2]),
    languages: Array.from(languages ?? []),
  };
}

async function enrichCandidate(candidate) {
  try {
    const html = await httpText(candidate.detailUrl, "text/html,application/xhtml+xml");
    const file = parseSingleArchive(html, candidate.languages);
    const result = {
      infoHash: candidate.infoHash,
      magnetUri: candidate.magnetUri,
      torrentUrl: candidate.torrentUrl,
      displayName: candidate.displayName,
      sizeBytes: candidate.sizeBytes,
      seeders: candidate.seeders,
      peers: candidate.peers,
      languages: candidate.languages,
    };
    if (file) result.files = [file];
    return result;
  } catch (_error) {
    return {
      infoHash: candidate.infoHash,
      magnetUri: candidate.magnetUri,
      torrentUrl: candidate.torrentUrl,
      displayName: candidate.displayName,
      sizeBytes: candidate.sizeBytes,
      seeders: candidate.seeders,
      peers: candidate.peers,
      languages: candidate.languages,
    };
  }
}

async function search(input) {
  if (input?.cursor != null) {
    return { items: [], nextCursor: null };
  }

  const titles = Array.isArray(input?.titles) ? input.titles : [];
  const title = titles.map(cleanText).find(Boolean);
  if (!title) throw new Error("Nyaa torrent search requires a title");

  const chapterNumber = cleanText(input?.chapterNumber);
  const query = [title, chapterNumber].filter(Boolean).join(" ");
  const category = categoryFor(input?.preferredLanguages);
  const url = `${BASE_URL}/?page=rss&c=${category}&f=0&q=${encodeURIComponent(query)}`;
  const xml = await httpText(url, "application/rss+xml,application/xml,text/xml");
  const discovered = parseSearchFeed(xml);
  const items = [];
  for (const candidate of discovered) {
    items.push(await enrichCandidate(candidate));
  }

  return { items, nextCursor: null };
}

export default {
  torrent: {
    search,
  },
};
