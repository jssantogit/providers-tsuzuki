/* MangaDex is one internal MangaAll source, never the MangaAll product. */
import * as mangaDex from "./modules/mangadex.js";
export default { reading: { lookup: mangaDex.lookup, chapters: mangaDex.chapters } };
