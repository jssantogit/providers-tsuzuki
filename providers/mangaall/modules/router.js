/*
 * Single-provider MangaAll source dispatcher.
 *
 * The Host sees only app.tsuzuki.mangaall. The source is carried in verified,
 * source-scoped work/chapter IDs, never inferred from the manga's title.
 * All three sources route pages from verified, source-scoped chapter IDs.
 * MangaDex stays development-only until credit, removal and image gates pass.
 */
const SOURCE_IDS = Object.freeze(["mangadex", "mangadot", "mangafire"]);
const SOURCE_SET = new Set(SOURCE_IDS);
const PROVIDER_ID = "app.tsuzuki.mangaall";
// Runtime output is capped at 64 KiB of UTF-8, not JavaScript UTF-16 code units.
// Leave substantial margin for the response envelope and continuation cursor.
const MAX_CURSOR_LENGTH = 512;
const MAX_LOOKUP_RESULT_BYTES = 48 * 1024;
const MAX_HOST_PAGE_ITEMS = 500;
const MAX_PAGE_ITEMS = 200;

function utf8ByteLength(value) {
  let bytes = 0;
  for (const point of value) {
    const code = point.codePointAt(0);
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
const MAX_SOURCE_CURSOR_LENGTH = 64;
const FIRE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SOURCE_LANGUAGES = Object.freeze({
  mangadex: new Set(["en", "pt-br"]),
  mangadot: new Set(["en", "pt-br"]),
  mangafire: new Set(["en"]),
});

// A source's ranked search results are hints, never proof of work identity.
// Only titles or source-attested aliases matching the requested title can
// enter edition selection or downstream automatic candidate assessment.
function lookupTitleMatches(requestedTitles, candidate) {
  const tokens = (value) => typeof value === "string"
    ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    : [];
  const requested = requestedTitles.map(tokens).filter((terms) => terms.length);
  const names = [candidate?.title, ...(Array.isArray(candidate?.aliases) ? candidate.aliases : [])];
  return requested.some((terms) => names.some((name) => {
    const found = new Set(tokens(name));
    return terms.every((term) => found.has(term));
  }));
}

function requireLanguage(binding, source) {
  const facet = binding?.facetId;
  if (typeof facet !== "string" || !facet.trim()) throw new Error("MangaAll missing language");
  const language = facet.trim().toLowerCase();
  if (!SOURCE_LANGUAGES[source].has(language)) throw new Error("MangaAll unsupported language");
  return language;
}


// Only closed failure codes and trustworthy HTTP status numbers may leave
// this SCRIPT provider. The Host already translates this envelope into
// SOURCE_READ_ERROR; unstructured upstream exceptions must stay private.
const LOOKUP_FAILURE_CODES = new Set([
  "CHALLENGE_BLOCKED", "HTTP_ERROR", "INVALID_RESPONSE", "UNCLASSIFIED_ERROR",
]);

function classifyLookupFailure(error) {
  const upstreamCode = error?.lookupFailureCode;
  if (LOOKUP_FAILURE_CODES.has(upstreamCode)) {
    const status = error?.lookupHttpStatus;
    return { code: upstreamCode, status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null };
  }
  if (error?.challengeRequired === true) {
    const status = error?.httpStatus;
    return { code: "CHALLENGE_BLOCKED", status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null };
  }
  const message = error instanceof Error ? error.message : "";
  const statusMatch = /^(?:MangaAll HTTP |MangaFire API request failed with HTTP )([1-5][0-9]{2})$/.exec(message);
  const status = Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599
    ? error.httpStatus : statusMatch ? Number(statusMatch[1]) : null;
  if (status !== null) {
    return { code: status === 403 ? "CHALLENGE_BLOCKED" : "HTTP_ERROR", status };
  }
  if (/^MangaAll invalid (?:HTTP response|HTTP status|JSON|API response|response size|source lookup response|source candidate)$/.test(message)) {
    return { code: "INVALID_RESPONSE", status: null };
  }
  return { code: "UNCLASSIFIED_ERROR", status: null };
}

function allSourcesFailed(replies) {
  const failures = replies.map((reply) => reply.error);
  const code = failures.every((entry) => entry.code === failures[0].code)
    ? failures[0].code : "UNCLASSIFIED_ERROR";
  const firstStatus = failures[0].status;
  const status = code !== "UNCLASSIFIED_ERROR" && firstStatus !== null &&
    failures.every((entry) => entry.status === firstStatus) ? firstStatus : null;
  return {
    items: [], nextCursor: null, lookupFailureCode: code,
    ...(status === null ? {} : { lookupHttpStatus: status }),
  };
}

function invalidCursor() { throw new Error("MangaAll invalid cursor"); }

function lookupState(value) {
  if (value == null) return SOURCE_IDS.map((source) => [source, null, false, 0]);
  if (typeof value !== "string" || value.length > MAX_CURSOR_LENGTH) invalidCursor();
  let parsed;
  try { parsed = JSON.parse(value); } catch { invalidCursor(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      parsed.v !== 1 || !parsed.remaining || typeof parsed.remaining !== "object" ||
      Array.isArray(parsed.remaining) || Object.keys(parsed).some((key) => key !== "v" && key !== "remaining")) {
    invalidCursor();
  }
  const keys = Object.keys(parsed.remaining);
  if (!keys.length || keys.some((key) => !SOURCE_SET.has(key))) invalidCursor();
  return SOURCE_IDS.filter((key) => keys.includes(key)).map((key) => {
    const entry = parsed.remaining[key];
    // A failed source is retried at most once, with the original cursor.
    // The explicit retry bit prevents unbounded pages for an outage.
    const structured = entry !== null && typeof entry === "object" && !Array.isArray(entry);
    const retry = structured && entry.r === 1 && Object.keys(entry).every(
      (part) => part === "r" || part === "c");
    // An offset into the *filtered current source page* allows splitting a
    // large result without discarding any source-attested aliases or IDs.
    // Re-fetching that page is bounded by the Host's eight-page lookup gate.
    const partial = structured && Object.hasOwn(entry, "o") &&
      Number.isInteger(entry.o) && entry.o >= 0 && entry.o <= MAX_PAGE_ITEMS &&
      Object.keys(entry).every((part) => part === "o" || part === "c");
    if (structured && !(retry || partial)) invalidCursor();
    if (structured && !Object.hasOwn(entry, "c")) invalidCursor();
    const cursor = structured ? entry.c : entry;
    if (cursor !== null &&
        (typeof cursor !== "string" || !cursor.length || cursor.length > MAX_SOURCE_CURSOR_LENGTH)) invalidCursor();
    if (cursor === null && !structured) invalidCursor();
    return [key, cursor, retry, partial ? entry.o : 0];
  });
}

function sourceForWork(binding) {
  if (!binding || typeof binding !== "object" ||
      (binding.providerId != null && binding.providerId !== PROVIDER_ID)) {
    throw new Error("MangaAll invalid work binding");
  }
  const value = binding.externalWorkId;
  if (typeof value !== "string" || value.length > 256) throw new Error("MangaAll invalid work ID");
  const index = value.indexOf(":");
  const source = value.slice(0, index);
  if (index <= 0 || !SOURCE_SET.has(source)) throw new Error("MangaAll unknown source");
  const localId = value.slice(index + 1);
  if (!localId || (source === "mangafire" && !FIRE_ID.test(localId))) {
    throw new Error("MangaAll invalid work ID");
  }
  return { source, localId };
}

function requireChapterId(source, id) {
  if (typeof id !== "string" || id.length > 256 || !id.startsWith(source + ":")) {
    throw new Error("MangaAll chapter source mismatch");
  }
  const localId = id.slice(source.length + 1);
  if (!localId || (source === "mangafire" && !FIRE_ID.test(localId))) {
    throw new Error("MangaAll invalid chapter ID");
  }
  return localId;
}

function sourceAdapter(adapters, source) {
  const adapter = adapters[source];
  if (!adapter || typeof adapter !== "object") throw new Error("MangaAll source unavailable");
  return adapter;
}

export function createMangaAllReading(adapters) {
  if (!adapters || typeof adapters !== "object") throw new Error("MangaAll adapters required");

  return Object.freeze({
    async lookup(input) {
      if (!Array.isArray(input?.titles) || !input.titles.some((x) => typeof x === "string" && x.trim())) {
        throw new Error("MangaAll missing title");
      }
      const pending = lookupState(input?.cursor);
      // Do not allow an upstream to prevent other independent source lookups.
      const replies = await Promise.all(pending.map(async ([source, cursor, retried, offset]) => {
        try {
          const adapter = sourceAdapter(adapters, source);
          if (typeof adapter.lookup !== "function") throw new Error("MangaAll lookup unavailable");
          const page = await adapter.lookup({ ...input, cursor });
          if (page?.lookupFailureCode) {
            const failure = new Error("MangaAll source lookup failed");
            failure.lookupFailureCode = page.lookupFailureCode;
            failure.lookupHttpStatus = page.lookupHttpStatus;
            throw failure;
          }
          if (!Array.isArray(page?.items) || page.items.length > MAX_PAGE_ITEMS ||
              (page.nextCursor != null && (typeof page.nextCursor !== "string" ||
                page.nextCursor.length === 0 || page.nextCursor.length > MAX_SOURCE_CURSOR_LENGTH))) {
            throw new Error("MangaAll invalid source lookup response");
          }
          const items = page.items.filter((candidate) => lookupTitleMatches(input.titles, candidate)).map((candidate) => {
            const id = candidate?.externalWorkId;
            if (typeof id !== "string" || !id.length) {
              throw new Error("MangaAll invalid source candidate");
            }
            if (source === "mangafire") {
              if (!FIRE_ID.test(id)) throw new Error("MangaAll invalid source candidate");
              return { ...candidate, externalWorkId: "mangafire:" + id };
            }
            if (!id.startsWith(source + ":") || !id.slice(source.length + 1)) {
              throw new Error("MangaAll invalid source candidate");
            }
            return candidate;
          });
          if (offset > items.length) throw new Error("MangaAll source page changed during continuation");
          return { source, items, nextCursor: page.nextCursor ?? null, cursor, offset };
        } catch (error) {
          return { source, failure: true, cursor, retried, error: classifyLookupFailure(error) };
        }
      }));
      const successful = replies.filter((r) => !r.failure);
      if (!successful.length) return allSourcesFailed(replies);
      const remaining = Object.create(null);
      const items = [];
      const seen = new Set();
      let serializedItemBytes = 0;
      for (const page of successful) {
        let consumed = page.offset;
        for (let index = page.offset; index < page.items.length; index++) {
          const item = page.items[index];
          if (seen.has(item.externalWorkId)) {
            consumed++;
            continue;
          }
          const encodedLength = utf8ByteLength(JSON.stringify(item)) + 1;
          if (encodedLength > MAX_LOOKUP_RESULT_BYTES) {
            throw new Error("MangaAll single source candidate exceeds Host result budget");
          }
          if (items.length >= MAX_HOST_PAGE_ITEMS ||
              serializedItemBytes + encodedLength > MAX_LOOKUP_RESULT_BYTES) {
            // Keep the cursor at the first *unreturned* item in this exact
            // source page. No alias truncation or accidental unique binding.
            break;
          }
          serializedItemBytes += encodedLength;
          seen.add(item.externalWorkId);
          items.push(item);
          consumed++;
        }
        if (consumed < page.items.length) {
          remaining[page.source] = { c: page.cursor, o: consumed };
        } else if (page.nextCursor !== null) {
          remaining[page.source] = page.nextCursor;
        }
      }
      for (const failure of replies.filter((reply) => reply.failure && !reply.retried)) {
        // Keep a failed source for one bounded retry. Do not invent "no
        // candidates" for a healthy source after another site went offline.
        remaining[failure.source] = { c: failure.cursor, r: 1 };
      }
      const nextCursor = Object.keys(remaining).length
        ? JSON.stringify({ v: 1, remaining }) : null;
      if (nextCursor && nextCursor.length > MAX_CURSOR_LENGTH) invalidCursor();
      return { items, nextCursor };
    },
    async chapters(input) {
      const { source, localId } = sourceForWork(input?.binding);
      const language = requireLanguage(input.binding, source);
      const adapter = sourceAdapter(adapters, source);
      if (typeof adapter.chapters !== "function") throw new Error("MangaAll chapters unavailable");
      const request = source === "mangafire"
        ? { ...input, binding: { ...input.binding, externalWorkId: localId } }
        : input;
      const page = await adapter.chapters(request);
      if (!Array.isArray(page?.items) || page.items.length > 16000) {
        throw new Error("MangaAll invalid chapter response");
      }
      const validLanguageItems = page.items.filter((chapter) => {
        // Unknown is kept UNKNOWN, not silently assigned to the requested facet.
        const declared = chapter?.language;
        if (declared == null) return true;
        if (typeof declared !== "string") throw new Error("MangaAll invalid chapter language");
        return declared.toLowerCase() === language;
      });
      // A nonempty upstream page containing only chapters from another language
      // is a source contract failure, NOT a complete-empty snapshot. Publishing
      // the latter could erase existing canonical evidence or hide real chapters.
      if (page.items.length > 0 && validLanguageItems.length === 0) {
        throw new Error("MangaAll chapter language mismatch");
      }
      const items = validLanguageItems.map((chapter) => {
        const id = chapter?.providerChapterId;
        if (typeof id !== "string" || !id.length) throw new Error("MangaAll invalid chapter ID");
        if (source === "mangafire") {
          if (!FIRE_ID.test(id)) throw new Error("MangaAll invalid chapter ID");
          return { ...chapter, providerChapterId: "mangafire:" + id };
        }
        requireChapterId(source, id);
        return chapter;
      });
      return { ...page, items };
    },
    async pages(input) {
      const { source, localId } = sourceForWork(input?.binding);
      requireLanguage(input.binding, source);
      const chapterId = requireChapterId(source, input?.providerChapterId);
      const adapter = sourceAdapter(adapters, source);
      if (typeof adapter.pages !== "function") {
        throw new Error("MangaAll pages not available for source");
      }
      const request = source === "mangafire"
        ? { ...input, binding: { ...input.binding, externalWorkId: localId }, providerChapterId: chapterId }
        : input;
      const response = await adapter.pages(request);
      if (response?.type !== "page_list" || !Array.isArray(response.pages) ||
          response.pages.length === 0 || response.pages.length > 5000) {
        throw new Error("MangaAll invalid source pages");
      }
      return response;
    },
  });
}
