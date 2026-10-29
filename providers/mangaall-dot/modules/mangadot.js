import { makeClient, safeText, sourceId, chapterNumber, dateMillis, facetLang, trustedImageUrl } from "./http.js";

const source = "mangadot";
const api = makeClient("https://mangadot.net", [
  "/api/search", /^\/api\/manga\/[1-9][0-9]{0,15}\/chapters\/list$/,
  /^\/api\/(?:uploads|chapters)\/[1-9][0-9]{0,15}\/images$/,
]);
function cleanId(v) {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return String(v);
  if (typeof v === "string" && /^[1-9][0-9]{0,15}$/.test(v)) return v;
  return null;
}
function pageNumber(cursor) {
  if (cursor === undefined || cursor === null) return 1;
  if (!/^[1-9][0-9]{0,2}$/.test(String(cursor))) throw new Error("MangaAll invalid cursor");
  const n = Number(cursor);
  if (n > 32) throw new Error("MangaAll invalid cursor");
  return n;
}
export async function lookup(input) {
  const title = safeText(input?.titles?.[0]);
  if (!title) throw new Error("MangaAll missing lookup title");
  const page = pageNumber(input?.cursor);
  const data = await api("GET", "/api/search", [
    ["search", title], ["page", page], ["limit", 56],
  ]);
  const rows = data.manga_list ?? data.results;
  // The MangaDot pagination DTO permits either total_pages/current_page or
  // next_cursor. A missing pagination block denotes one page, not an error.
  const pages = data.pagination ?? null;
  const current = pages?.current_page ?? pages?.currentPage ?? pages?.page ?? null;
  const total = pages?.total_pages ?? pages?.totalPages ?? pages?.last_page ?? null;
  const cursor = pages?.next_cursor ?? pages?.nextCursor ?? pages?.cursor ?? null;
  const hasNext = total != null
    ? page < total
    : typeof cursor === "string" && cursor.length > 0;
  if (!Array.isArray(rows) || rows.length > 56 ||
      (current != null && (!Number.isInteger(current) || current !== page)) ||
      (total != null && (!Number.isInteger(total) || total < 0 || total > 32)) ||
      (cursor != null && typeof cursor !== "string") ||
      (hasNext && (rows.length === 0 || page >= 32))) {
    throw new Error("MangaAll invalid API response");
  }
  const seen = new Set(), items = [];
  for (const row of rows) {
    const id = cleanId(row?.manga_id ?? row?.id);
    const title = safeText(row?.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    items.push({
      externalWorkId: source + ":" + id,
      title, aliases: [], url: "https://mangadot.net/manga/" + id, language: null,
    });
  }
  return { items, nextCursor: hasNext ? String(page + 1) : null };
}
export async function chapters(input) {
  const id = sourceId(source, input?.binding?.externalWorkId);
  if (!cleanId(id)) throw new Error("MangaAll invalid work ID");
  const lang = facetLang(input);
  const rows = await api("GET", "/api/manga/" + id + "/chapters/list");
  if (!Array.isArray(rows) || rows.length > 16000) throw new Error("MangaAll invalid API response");
  const items = [], seen = new Set();
  for (const row of rows) {
    const chapterId = cleanId(row?.id);
    const number = chapterNumber(row?.chapter_number);
    // MangaDot's language is optional. Preserve unknown languages as unknown
    // rather than assigning a requested facet's language to the chapter.
    const rawLanguage = row?.language;
    if (rawLanguage != null && typeof rawLanguage !== "string") continue;
    const chapterLanguage = rawLanguage == null ? null : rawLanguage.toLowerCase();
    if (!chapterId || number === null || seen.has(chapterId) ||
        (chapterLanguage != null && chapterLanguage !== lang)) continue;
    const title = safeText(row.chapter_title, 3900) || null;
    const groups = Array.isArray(row.groups) ? row.groups : [];
    const scanlationGroup = safeText(groups[0]?.name) ||
      safeText(row.group_name) || safeText(row.scanlator_name) || null;
    seen.add(chapterId);
    items.push({
      providerChapterId: source + ":" + (row.source == null || row.source === "user" ? "uploads" : "chapters") + ":" + chapterId,
      rawLabel: "Ch. " + number + (title ? " " + title : ""),
      rawNumber: number, title, language: chapterLanguage,
      scanlationGroup, releaseDateMillis: dateMillis(row.date_added),
    });
  }
  return { items, nextCursor: null };
}

// Distinguish user uploads from title chapters in the stable source-scoped ID.
// No source URL, path or dynamic origin from input is used to build the endpoint.
export async function pages(input) {
  const workId = sourceId(source, input?.binding?.externalWorkId);
  if (!cleanId(workId)) throw new Error("MangaAll invalid work ID");
  const chapterKey = input?.providerChapterId;
  const match = typeof chapterKey === "string"
    ? /^mangadot:(uploads|chapters):([1-9][0-9]{0,15})$/.exec(chapterKey) : null;
  if (!match) throw new Error("MangaAll invalid chapter ID");
  const kind = match[1], id = match[2];
  const response = await api("GET", "/api/" + kind + "/" + id + "/images");
  if (!response?.manga || String(response.manga.id) !== workId) {
    throw new Error("MangaAll work mismatch");
  }
  if (!Array.isArray(response.images) || response.images.length === 0 ||
      response.images.length > 5000) throw new Error("MangaAll invalid page metadata");
  const referer = "https://mangadot.net/chapter/" + id +
    (kind === "uploads" ? "?source=user" : "");
  return {
    type: "page_list",
    pages: response.images.map((item) => ({
      url: trustedImageUrl(item?.url, "https://mangadot.net"),
      headers: { Referer: referer },
    })),
  };
}
