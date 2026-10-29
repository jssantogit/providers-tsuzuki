import { makeClient, safeText, sourceId, chapterNumber, dateMillis, facetLang, trustedImageUrl } from "./http.js";

const source = "mangaball";
const api = makeClient("https://mangaball.com", [
  "/api/v1/title/search-advanced",
  "/api/v1/chapter/chapter-listing-by-title-id",
  "/api/v1/chapter-detail",
]);
function cursorPage(cursor) {
  if (cursor === null || cursor === undefined) return 1;
  if (!/^[1-9][0-9]{0,2}$/.test(String(cursor))) throw new Error("MangaAll invalid cursor");
  const page = Number(cursor);
  if (page > 32) throw new Error("MangaAll invalid cursor");
  return page;
}
function cleanId(value) {
  const id = typeof value === "number" ? String(value) : value;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  return id;
}
export async function lookup(input) {
  const title = safeText(input?.titles?.[0]);
  if (!title) throw new Error("MangaAll missing lookup title");
  const page = cursorPage(input?.cursor);
  const data = await api("GET", "/api/v1/title/search-advanced", [
    ["keyword", title], ["page", page], ["limit", 24], ["adult_mode", "no_18"],
  ]);
  if (!Array.isArray(data.data) || !data.pagination || !Number.isInteger(data.pagination.page)
      || !Number.isInteger(data.pagination.total_pages) || data.pagination.page !== page
      || data.pagination.total_pages < 0 || data.pagination.total_pages > 32
      || data.data.length > 24 || (page < data.pagination.total_pages && data.data.length === 0)) {
    throw new Error("MangaAll invalid API response");
  }
  const seen = new Set(), items = [];
  for (const work of data.data) {
    const id = cleanId(work?.id), name = safeText(work?.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    items.push({
      externalWorkId: source + ":" + id,
      title: name, aliases: [], url: "https://mangaball.com/title-detail/" + id, language: null,
    });
  }
  const nextCursor = page < data.pagination.total_pages ? String(page + 1) : null;
  return { items, nextCursor };
}
export async function chapters(input) {
  const workId = sourceId(source, input?.binding?.externalWorkId);
  const lang = facetLang(input);
  const data = await api("POST", "/api/v1/chapter/chapter-listing-by-title-id", [], { title_id: workId });
  if (!Array.isArray(data.data) || data.data.length > 16000) throw new Error("MangaAll invalid API response");
  const items = [], seen = new Set();
  for (const row of data.data) {
    const id = cleanId(row?.id);
    const number = chapterNumber(row?.number);
    if (!id || number === null || seen.has(id) || typeof row.lang !== "string" ||
        row.lang.toLowerCase() !== lang) continue;
    const title = safeText(row.name, 3900) || null;
    const volume = chapterNumber(row.volume);
    const validVolume = volume !== null && Number.isInteger(volume) ? volume : null;
    let label = (validVolume && validVolume > 0 ? "Vol. " + validVolume + " " : "") + "Ch. " + number;
    if (title) label += " " + title;
    seen.add(id);
    items.push({
      providerChapterId: source + ":" + id, rawLabel: label, rawNumber: number,
      ...(validVolume ? { volume: validVolume } : {}),
      title, language: lang, scanlationGroup: safeText(row?.group?.name) || null,
      releaseDateMillis: dateMillis(row.created_at),
    });
  }
  return { items, nextCursor: null };
}

// Prototype page delivery: only pages on the currently authorized source
// origin are accepted. External CDNs require explicit Host grants and review.
export async function pages(input) {
  const workId = sourceId(source, input?.binding?.externalWorkId);
  const chapterId = sourceId(source, input?.providerChapterId);
  const response = await api("GET", "/api/v1/chapter-detail", [["chapter_id", chapterId]]);
  const chapter = response?.data?.chapter;
  // A missing title_id cannot prove that this translation belongs to the
  // bound work. Fail closed rather than forwarding pages for an unrelated title.
  if (!chapter || chapter.title_id == null || String(chapter.title_id) !== workId) {
    throw new Error("MangaAll work mismatch");
  }
  const imageList = chapter.pages;
  if (!Array.isArray(imageList) || imageList.length === 0 || imageList.length > 5000) {
    throw new Error("MangaAll invalid page metadata");
  }
  return {
    type: "page_list",
    pages: imageList.map((url) => ({
      url: trustedImageUrl(url, "https://mangaball.com"),
      headers: { Referer: "https://mangaball.com" },
    })),
  };
}
