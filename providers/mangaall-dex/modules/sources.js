/*
 * MangaAll source inventory. An entry is not an executable adapter.
 * Planned sources have no network permission and cannot be dispatched.
 * The Tsuzuki Host V1 supports one binding per provider + facet; keep at
 * most one source enabled until source-qualified facets/bindings exist.
 */
export const SOURCES = Object.freeze([
  Object.freeze({ id: "mangalivre", name: "Manga Livre.to", status: "planned", enabled: false }),
  Object.freeze({ id: "mangadex", name: "MangaDex", status: "experimental", enabled: true }),
  Object.freeze({ id: "mangafire", name: "MangaFire", status: "planned", enabled: false }),
  Object.freeze({ id: "mangaball", name: "MangaBall", status: "planned", enabled: false }),
  Object.freeze({ id: "mangadot", name: "MangaDotNet (MangaDot)", status: "planned", enabled: false }),
  Object.freeze({ id: "animexnovel", name: "AnimeXNovel", status: "planned", enabled: false }),
  Object.freeze({ id: "mangaflix", name: "MangaFlix", status: "planned", enabled: false }),
]);
