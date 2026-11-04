/*
 * Single-provider MangaAll source dispatcher.
 *
 * The Host sees only app.tsuzuki.mangaall. The source is carried in verified,
 * source-scoped work/chapter IDs, never inferred from the manga's title.
 * No pages from MangaDex/MangaDot are advertised until validated for release.
 */
const SOURCE_IDS = Object.freeze(["mangadex", "mangadot", "mangafire"]);
const SOURCE_SET = new Set(SOURCE_IDS);
const PROVIDER_ID = "app.tsuzuki.mangaall";
const MAX_CURSOR_LENGTH = 256;
const MAX_PAGE_ITEMS = 200;
const MAX_SOURCE_CURSOR_LENGTH = 64;
const FIRE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function invalidCursor() { throw new Error("MangaAll invalid cursor"); }

function lookupState(value) {
  if (value == null) return SOURCE_IDS.map((source) => [source, null]);
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
    const cursor = parsed.remaining[key];
    if (typeof cursor !== "string" || !cursor.length || cursor.length > MAX_SOURCE_CURSOR_LENGTH) invalidCursor();
    return [key, cursor];
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
      const replies = await Promise.all(pending.map(async ([source, cursor]) => {
        try {
          const adapter = sourceAdapter(adapters, source);
          if (typeof adapter.lookup !== "function") throw new Error("MangaAll lookup unavailable");
          const page = await adapter.lookup({ ...input, cursor });
          if (page?.lookupFailureCode) throw new Error("MangaAll source lookup failed");
          if (!Array.isArray(page?.items) || page.items.length > MAX_PAGE_ITEMS ||
              (page.nextCursor != null && (typeof page.nextCursor !== "string" ||
                page.nextCursor.length === 0 || page.nextCursor.length > MAX_SOURCE_CURSOR_LENGTH))) {
            throw new Error("MangaAll invalid source lookup response");
          }
          const items = page.items.map((candidate) => {
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
          return { source, items, nextCursor: page.nextCursor ?? null };
        } catch {
          return { source, failure: true };
        }
      }));
      const successful = replies.filter((r) => !r.failure);
      if (!successful.length) throw new Error("MangaAll all sources failed");
      const remaining = Object.create(null);
      const items = [];
      const seen = new Set();
      for (const page of successful) {
        for (const item of page.items) {
          if (seen.has(item.externalWorkId)) continue;
          seen.add(item.externalWorkId);
          items.push(item);
        }
        if (page.nextCursor !== null) remaining[page.source] = page.nextCursor;
      }
      const nextCursor = Object.keys(remaining).length
        ? JSON.stringify({ v: 1, remaining }) : null;
      if (nextCursor && nextCursor.length > MAX_CURSOR_LENGTH) invalidCursor();
      return { items, nextCursor };
    },
    async chapters(input) {
      const { source, localId } = sourceForWork(input?.binding);
      const adapter = sourceAdapter(adapters, source);
      if (typeof adapter.chapters !== "function") throw new Error("MangaAll chapters unavailable");
      const request = source === "mangafire"
        ? { ...input, binding: { ...input.binding, externalWorkId: localId } }
        : input;
      const page = await adapter.chapters(request);
      if (!Array.isArray(page?.items) || page.items.length > 16000) {
        throw new Error("MangaAll invalid chapter response");
      }
      const items = page.items.map((chapter) => {
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
      const chapterId = requireChapterId(source, input?.providerChapterId);
      const adapter = sourceAdapter(adapters, source);
      if (source !== "mangafire" || typeof adapter.pages !== "function") {
        throw new Error("MangaAll pages not available for source");
      }
      const request = {
        ...input,
        binding: { ...input.binding, externalWorkId: localId },
        providerChapterId: chapterId,
      };
      return adapter.pages(request);
    },
  });
}
