/*
 * MangaAll SCRIPT Provider — opt-in prototype.
 * Host V1 binds one work per provider+facet. Until source-qualified bindings
 * are implemented, only the explicitly enabled adapter may participate.
 * Do not publish this package to the signed repository before policy review.
 */
import * as mangaDex from "./modules/mangadex.js";
import { SOURCES } from "./modules/sources.js";

const ADAPTERS = Object.freeze({ mangadex: mangaDex });

function soleActiveAdapter() {
  const enabled = SOURCES.filter((source) => source.enabled);
  if (enabled.length !== 1 || !ADAPTERS[enabled[0].id]) {
    throw new Error("MangaAll Host V1 requires exactly one active source");
  }
  return ADAPTERS[enabled[0].id];
}

export default {
  reading: {
    lookup: (input) => soleActiveAdapter().lookup(input),
    chapters: (input) => soleActiveAdapter().chapters(input),
  },
};
