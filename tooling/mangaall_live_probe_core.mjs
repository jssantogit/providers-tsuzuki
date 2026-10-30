// Non-shipping diagnostic utility. HTTP requests only to each adapter's
// manifest origin, with strict method/header/redirect limits. No challenge bypass.
const METHODS = new Set(["GET", "POST"]);
const HEADERS = new Set(["accept", "content-type", "user-agent", "origin", "referer"]);

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
            (key.toLowerCase() === "origin" && value !== origin) ||
            (key.toLowerCase() === "referer" && value !== origin + "/") ||
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

  // Node fetch wraps TLS/DNS/socket failures in a generic "fetch failed"
  // TypeError. Distinguish only known codes from a bounded cause chain,
  // without serializing exception messages, URLs, addresses or certificates.
  const seen = new Set();
  let cause = error;
  for (let depth = 0; depth < 5 && cause && typeof cause === "object" &&
       !seen.has(cause); depth++, cause = cause.cause) {
    seen.add(cause);
    const code = typeof cause.code === "string" ? cause.code : "";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "transport_dns";
    if (code.startsWith("ERR_SSL_") || code.startsWith("ERR_TLS_") ||
        ["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT",
          "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(code)) return "transport_tls";
    if (["ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(code)) {
      return "transport_connect";
    }
    if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return "transport_timeout";
  }
  if (error?.name === "TimeoutError") return "transport_timeout";
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
  if (!page || typeof page.url !== "string" || !Array.isArray(allowedOrigins)) return false;
  try {
    const u = new URL(page.url);
    if (u.username || u.password || u.hash || u.protocol !== "https:" || u.port) return false;
    return allowedOrigins.some((grant) => {
      if (typeof grant !== "string") return false;
      if (!grant.startsWith("https://*.")) return u.origin === grant;
      // Honor the Host's HTTPS subdomain grant; never match the apex,
      // lookalike suffix, credentials, or a non-standard port.
      const suffix = grant.slice("https://*.".length);
      return /^[a-z0-9.-]+$/i.test(suffix) &&
        u.hostname.endsWith("." + suffix) &&
        u.hostname.length > suffix.length + 1;
    });
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
  // The first chapters may be external links, even if later chapters
  // are hosted. Spread the same three-attempt budget across the feed instead
  // of always sampling only the beginning. This is a diagnostic sample, not
  // a guarantee of full Reader availability or a reason to bypass errors.
  const count = chapters.items.length;
  const sampleIndices = [...new Set([0, Math.floor((count - 1) / 2), count - 1])];
  for (const index of sampleIndices) {
    const chapter = chapters.items[index];
    let delivery;
    try {
      delivery = await adapter.pages({
        binding: {
          providerId, facetId: language, externalWorkId: chosen.externalWorkId,
        },
        providerChapterId: chapter.providerChapterId,
      });
    } catch (error) {
      const outcome = safeOutcome(error);
      if (outcome === "external_chapter") continue;
      return { ...base, phase: "pages", outcome, chapterCount: chapters.items.length };
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
  return { ...base, phase: "pages", outcome: "external_chapter", chapterCount: chapters.items.length };
}
