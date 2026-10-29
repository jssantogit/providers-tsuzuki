/**
 * MangaAll aggregation boundary, separate from all upstream source identities.
 *
 * This is the prototype orchestration contract. The Tsuzuki SCRIPT V1 Host
 * cannot currently bind multiple upstream identities under one Provider ID;
 * until a Host-level group is implemented, the isolated packages own grants
 * and real chapter/Reader calls. Do not publish this facade as a SCRIPT Provider.
 */
const SOURCE_IDS = Object.freeze(["mangadex", "mangaball", "mangadot"]);

export function createMangaAll(adapters) {
  if (!adapters || typeof adapters !== "object") throw new Error("MangaAll adapters required");
  const selected = SOURCE_IDS.filter((id) => adapters[id]);

  function adapterFor(sourceId) {
    if (!SOURCE_IDS.includes(sourceId) || !adapters[sourceId]) {
      throw new Error("MangaAll unknown source");
    }
    return adapters[sourceId];
  }
  function requireBinding(sourceId, request) {
    const work = request?.binding?.externalWorkId;
    if (typeof work !== "string" || !work.startsWith(sourceId + ":")) {
      throw new Error("MangaAll source mismatch in binding");
    }
  }

  return Object.freeze({
    async lookupAcross(request) {
      const results = await Promise.all(selected.map(async (sourceId) => {
        try {
          const page = await adapterFor(sourceId).lookup(request);
          if (!Array.isArray(page?.items)) throw new Error("Invalid lookup response");
          // No title-based cross-source deduplication or chapter synthesis.
          return [sourceId, { status: "success", items: page.items, nextCursor: page.nextCursor ?? null }];
        } catch (_error) {
          // Do not leak remote body/URL/identifiers and do not silence other sources.
          return [sourceId, { status: "error", reason: "source_failed" }];
        }
      }));
      return Object.fromEntries(results);
    },
    async chapters(sourceId, request) {
      requireBinding(sourceId, request);
      const adapter = adapterFor(sourceId);
      if (typeof adapter.chapters !== "function") throw new Error("MangaAll chapters unavailable");
      return adapter.chapters(request);
    },
    async pages(sourceId, request) {
      requireBinding(sourceId, request);
      if (typeof request?.providerChapterId !== "string" ||
          !request.providerChapterId.startsWith(sourceId + ":")) {
        throw new Error("MangaAll source mismatch in chapter");
      }
      const adapter = adapterFor(sourceId);
      if (typeof adapter.pages !== "function") throw new Error("MangaAll pages unavailable");
      return adapter.pages(request);
    },
  });
}
