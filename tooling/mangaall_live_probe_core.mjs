// Non-shipping diagnostic utility. HTTP requests only to each adapter's
// manifest origin, with strict method/header/redirect limits. No challenge bypass.
const METHODS = new Set(["GET", "POST"]);
const HEADERS = new Set(["accept", "content-type", "user-agent"]);

async function readBounded(response, maxResponseBytes) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > maxResponseBytes) {
      throw Error("MangaAll response too large");
    }
    return body;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxResponseBytes) {
        await reader.cancel();
        throw Error("MangaAll response too large");
      }
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export function createHttpBridge({
  origin, fetchImpl = fetch, maxRequests = 8, maxResponseBytes = 2 * 1024 * 1024,
  timeoutMs = 12000,
}) {
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin)) {
    throw Error("MangaAll invalid expected origin");
  }
  let requests = 0;
  return {
    async request(method, url, headersJson, body) {
      if (!METHODS.has(method)) throw Error("MangaAll unsupported method");
      let destination;
      try { destination = new URL(url); } catch (_) { throw Error("MangaAll unauthorized origin"); }
      if (destination.origin !== origin || destination.username || destination.password ||
          destination.hash) throw Error("MangaAll unauthorized origin");
      let headers;
      try { headers = JSON.parse(headersJson || "{}"); } catch (_) { throw Error("MangaAll forbidden header"); }
      if (!headers || typeof headers !== "object" || Array.isArray(headers) ||
          Object.entries(headers).some(([key, value]) =>
            !HEADERS.has(key.toLowerCase()) || typeof value !== "string" ||
            (key.toLowerCase() === "user-agent" && value !== "Tsuzuki-MangaAll/0.1 (+https://github.com/jssantogit/providers-tsuzuki)") ||
            /[\r\n]/.test(value) || value.length > 128)) {
        throw Error("MangaAll forbidden header");
      }
      if (body != null && (method !== "POST" || typeof body !== "string" ||
          Buffer.byteLength(body, "utf8") > 4096)) {
        throw Error("MangaAll invalid request body");
      }
      if (requests >= maxRequests) throw Error("MangaAll request limit");
      requests++;
      const response = await fetchImpl(url, {
        method, headers, body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseBody = await readBounded(response, maxResponseBytes);
      return JSON.stringify({ statusCode: response.status, body: responseBody });
    },
    get requestCount() { return requests; },
  };
}

function exactKey(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}
function safeOutcome(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  const http = /^MangaAll HTTP (\d{3})\b/.exec(message);
  if (http) return "upstream_http_" + http[1];
  const known = [
    ["MangaAll invalid JSON", "invalid_json"],
    ["MangaAll invalid API response", "invalid_api_response"],
    ["MangaAll untrusted image origin", "untrusted_image_origin"],
    ["MangaAll invalid page metadata", "invalid_page_metadata"],
    ["MangaAll external chapter", "external_chapter"],
    ["MangaAll work mismatch", "work_mismatch"],
    ["MangaAll incomplete page", "incomplete_page"],
    ["MangaAll inconsistent page", "inconsistent_page"],
  ];
  return known.find(([prefix]) => message.startsWith(prefix))?.[1] || "upstream_failed";
}
function insideGrant(page, allowedOrigins) {
  if (!page || typeof page.url !== "string") return false;
  try {
    const u = new URL(page.url);
    return !u.username && !u.password && !u.hash &&
      u.protocol === "https:" && allowedOrigins.includes(u.origin);
  } catch (_) { return false; }
}

// Probe exactly one safe title binding per source. Only sample chapter/page
// metadata. Never infer editorial identity or download page bytes.
export async function inspectSource({
  sourceId, title, language, providerId, allowedOrigins, adapter,
}) {
  const base = { source: sourceId };
  let page;
  try {
    page = await adapter.lookup({ titles: [title], cursor: null });
  } catch (error) {
    return { ...base, phase: "lookup", outcome: safeOutcome(error) };
  }
  if (!Array.isArray(page?.items) || page.items.length > 100) {
    return { ...base, outcome: "invalid_lookup" };
  }
  const key = exactKey(title);
  const matches = page.items.filter(candidate =>
    exactKey(candidate?.title) === key ||
    (Array.isArray(candidate?.aliases) && candidate.aliases.some(alias => exactKey(alias) === key)));
  if (matches.length === 0) return {
    ...base, outcome: "no_safe_match",
    candidateCount: page.items.length, exactMatchCount: 0,
  };
  if (matches.length !== 1) return {
    ...base, outcome: "ambiguous",
    candidateCount: page.items.length, exactMatchCount: matches.length,
  };
  const chosen = matches[0];
  if (typeof chosen.externalWorkId !== "string" ||
      !chosen.externalWorkId.startsWith(sourceId + ":")) {
    return { ...base, outcome: "invalid_binding" };
  }
  let chapters;
  try {
    chapters = await adapter.chapters({
      binding: {
        providerId, facetId: language, externalWorkId: chosen.externalWorkId,
      },
      cursor: null,
    });
  } catch (error) {
    return { ...base, phase: "chapters", outcome: safeOutcome(error) };
  }
  if (!Array.isArray(chapters?.items) || chapters.items.length > 10000 ||
      chapters.items.some(item => typeof item?.providerChapterId !== "string" ||
      !item.providerChapterId.startsWith(sourceId + ":"))) {
    return { ...base, outcome: "invalid_chapters" };
  }
  if (chapters.items.length === 0) return {
    ...base, outcome: "chapters_empty", candidateCount: page.items.length,
    exactMatchCount: 1, chapterCount: 0,
  };
  if (typeof adapter.pages !== "function") return { ...base, outcome: "pages_unavailable" };
  let delivery;
  try {
    delivery = await adapter.pages({
      binding: {
        providerId, facetId: language, externalWorkId: chosen.externalWorkId,
      },
      providerChapterId: chapters.items[0].providerChapterId,
    });
  } catch (error) {
    return { ...base, phase: "pages", outcome: safeOutcome(error), chapterCount: chapters.items.length };
  }
  if (delivery?.type !== "page_list" || !Array.isArray(delivery.pages) ||
      delivery.pages.length === 0 || delivery.pages.length > 5000) {
    return { ...base, outcome: "pages_unavailable" };
  }
  return {
    ...base, outcome: "observed", candidateCount: page.items.length,
    exactMatchCount: 1, chapterCount: chapters.items.length,
    pageMetadataCount: delivery.pages.length,
    pagesInsideGrantedOrigins: delivery.pages.every(p => insideGrant(p, allowedOrigins)),
  };
}
