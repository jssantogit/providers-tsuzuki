/*
 * MangaAll is ONE signed provider; MangaDex, MangaDot and MangaFire are internal
 * content sources. Do not publish independent source packages as MangaAll.
 *
 * The existing, tested MangaFire implementation is reused without changing
 * its standalone ID or requiring its standalone package to be installed.
 */
import { createMangaAllReading } from "./modules/router.js";
import mangaDex from "./modules/sources/mangadex/main.js";
import mangaDot from "./modules/sources/mangadot/main.js";
import mangaFire from "./modules/sources/mangafire/main.js";

export default {
  reading: createMangaAllReading({
    mangadex: mangaDex.reading,
    mangadot: mangaDot.reading,
    mangafire: mangaFire.reading,
  }),
};
