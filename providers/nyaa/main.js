const BASE_URL = "https://nyaa.si";
const MAX_RESULTS = 20;
const MAX_TITLES = 16;
const DETAIL_PAGE_SIZE = 3;
const DETAIL_CURSOR_PREFIX = "after:";
const SNAPSHOT_CURSOR_PREFIX = "snapshot:";
const MAX_CURSOR_CHARS = 4096;
const MAX_PARALLEL_CURSORS = 7;
const DISCOVERY_SOFT_BUDGET_MS = 2500;
const TRACKERS = [
  "udp://open.stealth.si:80/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://exodus.desync.com:6969/announce",
];

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanTitles(values) {
  const seen = new Set();
  const titles = [];
  for (const value of Array.isArray(values) ? values : []) {
    const title = cleanText(value);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= MAX_TITLES) break;
  }
  return titles;
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

function nyaaPath(value, expectedPrefix) {
  const match = cleanText(value).match(/^https:\/\/nyaa\.si(\/[^?#]*)?(?:[?#].*)?$/i);
  if (!match) return null;
  const pathname = match[1] || "/";
  return pathname.startsWith(expectedPrefix) ? pathname : null;
}

function validNyaaUrl(value, expectedPrefix) {
  return nyaaPath(value, expectedPrefix) != null;
}

function decodeQueryComponent(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch (_error) {
    return null;
  }
}

function matchingMagnet(value, infoHash) {
  const text = cleanText(value);
  if (!/^magnet:\?/i.test(text)) return false;

  const query = text.slice(text.indexOf("?") + 1);
  const expected = `urn:btih:${infoHash.toLowerCase()}`;
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const key = decodeQueryComponent(pair.slice(0, separator));
    const parameter = decodeQueryComponent(pair.slice(separator + 1));
    if (key?.toLowerCase() === "xt" && cleanText(parameter).toLowerCase() === expected) {
      return true;
    }
  }
  return false;
}

function magnetFor(infoHash, displayName) {
  const params = [
    `xt=urn:btih:${infoHash}`,
    `dn=${encodeURIComponent(displayName)}`,
    ...TRACKERS.map((tracker) => `tr=${encodeURIComponent(tracker)}`),
  ];
  return `magnet:?${params.join("&")}`;
}

function parseDetailCursor(value) {
  const match = cleanText(value).match(/^after:([0-9a-f]{40}|[0-9a-f]{64})$/i);
  return match ? match[1].toLowerCase() : null;
}

function detailCursorFor(infoHash) {
  return `${DETAIL_CURSOR_PREFIX}${infoHash}`;
}

function snapshotLanguageCode(languages) {
  const values = Array.from(languages ?? []);
  if (values.length === 0) return "";
  if (values.length === 1 && values[0] === "en") return "e";
  if (values.length === 1 && values[0] === "ja") return "j";
  return null;
}

function snapshotCandidateFor(candidate) {
  const detailPath = nyaaPath(candidate.detailUrl, "/view/");
  if (detailPath == null || !/^\/view\/\d+$/.test(detailPath)) return null;

  let torrentPath = null;
  if (candidate.torrentUrl != null) {
    torrentPath = nyaaPath(candidate.torrentUrl, "/download/");
    if (torrentPath == null || !/^\/download\/\d+\.torrent$/.test(torrentPath)) return null;
  }

  const languageCode = snapshotLanguageCode(candidate.languages);
  if (languageCode == null) return null;

  return [
    candidate.infoHash,
    torrentPath,
    detailPath,
    candidate.displayName,
    candidate.sizeBytes ?? null,
    candidate.seeders ?? null,
    candidate.peers ?? null,
    languageCode,
  ];
}

function snapshotCursorFor(compactCandidates, hasMore) {
  const cursor = `${SNAPSHOT_CURSOR_PREFIX}${JSON.stringify([hasMore ? 1 : 0, compactCandidates])}`;
  return cursor.length <= MAX_CURSOR_CHARS ? cursor : null;
}

function continuationCursorFor(remainingCandidates, fallbackInfoHash) {
  if (remainingCandidates.length === 0) return null;

  const compactCandidates = [];
  for (let index = 0; index < remainingCandidates.length; index += 1) {
    const compact = snapshotCandidateFor(remainingCandidates[index]);
    if (compact == null) break;

    const nextCompact = [...compactCandidates, compact];
    const hasMore = index < remainingCandidates.length - 1;
    if (snapshotCursorFor(nextCompact, hasMore) == null) break;
    compactCandidates.push(compact);
  }

  if (compactCandidates.length === 0) {
    return detailCursorFor(fallbackInfoHash);
  }

  const hasMore = compactCandidates.length < remainingCandidates.length;
  return snapshotCursorFor(compactCandidates, hasMore) ?? detailCursorFor(fallbackInfoHash);
}

function independentContinuationCursors(remainingCandidates) {
  if (remainingCandidates.length === 0) return [];

  const cursors = [];
  for (let index = 0; index < remainingCandidates.length; index += DETAIL_PAGE_SIZE) {
    const chunk = remainingCandidates.slice(index, index + DETAIL_PAGE_SIZE);
    const compactChunk = chunk.map(snapshotCandidateFor);
    if (compactChunk.some((candidate) => candidate == null)) return [];

    const cursor = snapshotCursorFor(compactChunk, false);
    if (cursor == null) return [];
    cursors.push(cursor);
    if (cursors.length > MAX_PARALLEL_CURSORS) return [];
  }
  return cursors;
}

function parseSnapshotCandidate(value) {
  if (!Array.isArray(value) || value.length !== 8) return null;

  const infoHash = cleanText(value[0]).toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(infoHash)) return null;

  const torrentPath = value[1];
  if (torrentPath != null && (typeof torrentPath !== "string" || !/^\/download\/\d+\.torrent$/.test(torrentPath))) {
    return null;
  }

  const detailPath = value[2];
  if (typeof detailPath !== "string" || !/^\/view\/\d+$/.test(detailPath)) return null;

  const displayName = cleanText(value[3]);
  if (!displayName) return null;

  const sizeBytes = value[4];
  if (sizeBytes != null && (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)) return null;
  const seeders = value[5];
  if (seeders != null && (!Number.isSafeInteger(seeders) || seeders < 0)) return null;
  const peers = value[6];
  if (peers != null && (!Number.isSafeInteger(peers) || peers < 0)) return null;

  const languageCode = value[7];
  const languages = languageCode === "" ? [] : languageCode === "e" ? ["en"] : languageCode === "j" ? ["ja"] : null;
  if (languages == null) return null;

  return {
    infoHash,
    magnetUri: magnetFor(infoHash, displayName),
    torrentUrl: torrentPath == null ? undefined : `${BASE_URL}${torrentPath}`,
    detailUrl: `${BASE_URL}${detailPath}`,
    displayName,
    sizeBytes,
    seeders,
    peers,
    languages,
  };
}

function parseSnapshotCursor(value) {
  const text = cleanText(value);
  if (!text.startsWith(SNAPSHOT_CURSOR_PREFIX)) return null;

  try {
    const payload = JSON.parse(text.slice(SNAPSHOT_CURSOR_PREFIX.length));
    if (!Array.isArray(payload) || payload.length !== 2) return null;
    const hasMoreFlag = payload[0];
    if (hasMoreFlag !== 0 && hasMoreFlag !== 1) return null;
    const rawCandidates = payload[1];
    if (!Array.isArray(rawCandidates) || rawCandidates.length === 0 || rawCandidates.length > MAX_RESULTS) return null;

    const candidates = rawCandidates.map(parseSnapshotCandidate);
    if (candidates.some((candidate) => candidate == null)) return null;
    const seen = new Set(candidates.map((candidate) => candidate.infoHash));
    if (seen.size !== candidates.length) return null;

    return {
      candidates,
      hasMore: hasMoreFlag === 1,
    };
  } catch (_error) {
    return null;
  }
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

function requireRssFeed(xml) {
  const body = cleanText(xml).replace(/^<\?xml[^>]*>\s*/i, "");
  const hasRssRoot = /^<rss\b/i.test(body);
  const hasClosedChannel = /<channel\b[\s\S]*<\/channel>\s*<\/rss>\s*$/i.test(body);
  if (!hasRssRoot || !hasClosedChannel) {
    throw new Error("Nyaa search response was not an RSS feed");
  }
  return body;
}

function rawItemCount(xml) {
  return (xml.match(/<item\b/gi) ?? []).length;
}

async function logDiscovery(phase, rawCount, acceptedCount, startedAtMillis) {
  const info = globalThis.tsuzuki?.log?.info;
  if (typeof info !== "function") return;
  try {
    await info(JSON.stringify({
      event: "nyaa_discovery",
      phase,
      rawItemCount: rawCount,
      acceptedCandidateCount: acceptedCount,
      elapsedMs: Math.max(0, Date.now() - startedAtMillis),
    }));
  } catch (_error) {
    // Diagnostics must never change Provider discovery behavior.
  }
}

function parseSearchFeed(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const items = [];
  const seen = new Set();

  for (const block of blocks) {
    const infoHash = xmlTag(block, "nyaa:infoHash").toLowerCase();
    const displayName = xmlTag(block, "title");
    const link = xmlTag(block, "link");
    const detailUrl = xmlTag(block, "guid");
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(infoHash)) continue;
    if (!displayName || seen.has(infoHash)) continue;
    const torrentUrl = validNyaaUrl(link, "/download/") ? link : undefined;
    if (torrentUrl == null && !matchingMagnet(link, infoHash)) continue;
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

async function discover(query, category, phase) {
  const startedAtMillis = Date.now();
  const url = `${BASE_URL}/?page=rss&c=${category}&f=0&q=${encodeURIComponent(query)}`;
  const xml = requireRssFeed(await httpText(url, "application/rss+xml,application/xml,text/xml"));
  const items = parseSearchFeed(xml);
  await logDiscovery(phase, rawItemCount(xml), items.length, startedAtMillis);
  return items;
}

function hasDiscoveryBudget(deadlineMillis) {
  return Date.now() < deadlineMillis;
}

async function discoverTitle(title, chapterNumber, category, deadlineMillis, preserveFallback, phasePrefix) {
  if (!hasDiscoveryBudget(deadlineMillis)) return [];

  const narrowQuery = [title, chapterNumber].filter(Boolean).join(" ");
  let discovered = await discover(narrowQuery, category, `${phasePrefix}_narrow`);
  if (
    discovered.length === 0 &&
    chapterNumber &&
    (preserveFallback || hasDiscoveryBudget(deadlineMillis))
  ) {
    discovered = await discover(title, category, `${phasePrefix}_fallback`);
  }
  return discovered;
}

async function search(input) {
  const rawCursor = input?.cursor;
  const cursorText = rawCursor == null ? null : cleanText(rawCursor);
  const usesSnapshot = cursorText?.startsWith(SNAPSHOT_CURSOR_PREFIX) === true;
  const snapshot = usesSnapshot ? parseSnapshotCursor(cursorText) : null;
  if (usesSnapshot && snapshot == null) {
    return { items: [], nextCursor: null };
  }

  const cursorInfoHash = rawCursor == null || usesSnapshot ? null : parseDetailCursor(rawCursor);
  if (rawCursor != null && !usesSnapshot && cursorInfoHash == null) {
    return { items: [], nextCursor: null };
  }

  const titles = cleanTitles(input?.titles);
  if (titles.length === 0) throw new Error("Nyaa torrent search requires a title");

  let discovered;
  let startIndex = 0;
  if (snapshot != null) {
    discovered = snapshot.candidates;
  } else {
    const chapterNumber = cleanText(input?.chapterNumber);
    const category = categoryFor(input?.preferredLanguages);
    const discoveryDeadlineMillis = Date.now() + DISCOVERY_SOFT_BUDGET_MS;
    discovered = [];
    for (let index = 0; index < titles.length; index += 1) {
      if (index > 0 && !hasDiscoveryBudget(discoveryDeadlineMillis)) break;
      discovered = await discoverTitle(
        titles[index],
        chapterNumber,
        category,
        discoveryDeadlineMillis,
        index === 0,
        index === 0 ? "primary" : "alias",
      );
      if (discovered.length > 0) break;
    }

    if (cursorInfoHash != null) {
      const anchorIndex = discovered.findIndex((candidate) => candidate.infoHash === cursorInfoHash);
      if (anchorIndex < 0) {
        return { items: [], nextCursor: null };
      }
      startIndex = anchorIndex + 1;
    }
  }

  const pageCandidates = discovered.slice(startIndex, startIndex + DETAIL_PAGE_SIZE);
  const items = await Promise.all(pageCandidates.map((candidate) => enrichCandidate(candidate)));
  const endIndex = startIndex + pageCandidates.length;

  let nextCursor = null;
  const remaining = discovered.slice(endIndex);
  if (pageCandidates.length > 0) {
    const lastInfoHash = pageCandidates[pageCandidates.length - 1].infoHash;
    if (snapshot != null) {
      if (remaining.length > 0) {
        const compactRemaining = remaining.map(snapshotCandidateFor);
        if (compactRemaining.every((candidate) => candidate != null)) {
          nextCursor = snapshotCursorFor(compactRemaining, snapshot.hasMore);
        }
        if (nextCursor == null) {
          nextCursor = detailCursorFor(lastInfoHash);
        }
      } else if (snapshot.hasMore) {
        nextCursor = detailCursorFor(lastInfoHash);
      }
    } else if (remaining.length > 0) {
      nextCursor = continuationCursorFor(remaining, lastInfoHash);
    }
  }

  const result = { items, nextCursor };
  if (rawCursor == null && remaining.length > 0) {
    const parallelCursors = independentContinuationCursors(remaining);
    if (parallelCursors.length > 0) result.parallelCursors = parallelCursors;
  }
  return result;
}

export default {
  torrent: {
    search,
  },
};