import { makeClient, safeText, sourceId, chapterNumber, dateMillis, facetLang, trustedImageUrl } from "./http.js";

const source = "mangaball";
const api = makeClient("https://mangaball.com", [
  "/api/v1/title/search-advanced",
  "/api/v1/chapter/chapter-listing-by-title-id",
  "/api/v1/chapter-detail",
  /^\/api\/v1\/title\/detail\/[A-Za-z0-9_-]{1,128}$/,
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
  // MangaBall has used both page/total_pages (older DTO) and
  // current_page/last_page (documented live responses). The first empty
  // search page can legitimately have last_page=0; do not treat it as a
  // network failure or synthesize extra pages.
  const paging = data?.pagination;
  const current = paging?.current_page ?? paging?.page;
  const last = paging?.last_page ?? paging?.total_pages;
  if ((data?.code != null && data.code !== 200) ||
      !Array.isArray(data?.data) || !paging ||
      !Number.isInteger(current) || !Number.isInteger(last) ||
      current !== page || last < 0 || last > 32 ||
      data.data.length > 24 ||
      (page < last && data.data.length === 0)) {
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
  // Search results normally omit aliases even though title detail exposes
  // alternateName. Enrich only a few candidates when there is no direct exact
  // match, preserving the Host's strict unique title/alias binding rule.
  const key = title.replace(/\\s+/g, " ").toLowerCase();
  const directlyMatched = items.some(item =>
    item.title.replace(/\\s+/g, " ").toLowerCase() === key);
  if (!directlyMatched) {
    for (const candidate of items.slice(0, 3)) {
      const id = candidate.externalWorkId.slice(source.length + 1);
      try {
        const detail = await api("GET", "/api/v1/title/detail/" + id);
        const record = detail?.data;
        if ((detail.code != null && detail.code !== 200) ||
            !record || String(record.id) !== id || !Array.isArray(record.alternateName)) continue;
        const seenAliases = new Set([candidate.title.toLowerCase()]);
        for (const raw of record.alternateName) {
          const alias = safeText(raw);
          if (!alias || seenAliases.has(alias.toLowerCase())) continue;
          seenAliases.add(alias.toLowerCase());
          candidate.aliases.push(alias);
          if (candidate.aliases.length >= 32) break;
        }
      } catch (_) {
        // An unavailable detail endpoint must not falsify the search result,
        // create an unverified alias, or prompt unrestricted retries.
      }
    }
  }
  const nextCursor = page < last ? String(page + 1) : null;
  return { items, nextCursor };
}
export async function chapters(input) {
  const workId = sourceId(source, input?.binding?.externalWorkId);
  const lang = facetLang(input);
  const data = await api("POST", "/api/v1/chapter/chapter-listing-by-title-id", [], { title_id: workId });
  // The API has two documented response schemas. Older feeds return flat
  // data: ChapterDto[]; grouped feeds return ALL_CHAPTERS with independent
  // translations. Never collapse translations solely by chapter number.
  const grouped = Array.isArray(data?.ALL_CHAPTERS);
  const rows = grouped ? data.ALL_CHAPTERS : data?.data;
  if ((data?.code != null && data.code !== 200) ||
      !Array.isArray(rows) || rows.length > 16000) {
    throw new Error("MangaAll invalid API response");
  }
  const items = [], seen = new Set();
  function add(row, parent = null) {
    const id = cleanId(row?.id);
    const language = row?.language ?? row?.lang;
    const numeric = parent
      ? parent.number_float ?? parent.number
      : row?.number;
    // Group chapter numbers may be formatted as "Ch. 12".
    const raw = typeof numeric === "string"
      ? numeric.replace(/^ch\.\s*/i, "").trim() : numeric;
    const number = chapterNumber(raw);
    if (!id || number === null || seen.has(id) ||
        typeof language !== "string" || language.toLowerCase() !== lang) return;
    const title = safeText(row?.name ?? parent?.title, 3900) || null;
    const volume = chapterNumber(parent?.volume ?? row?.volume);
    const validVolume = volume !== null && Number.isInteger(volume) ? volume : null;
    let label = (validVolume && validVolume > 0 ? "Vol. " + validVolume + " " : "") + "Ch. " + number;
    if (title) label += " " + title;
    seen.add(id);
    items.push({
      providerChapterId: source + ":" + id, rawLabel: label, rawNumber: number,
      ...(validVolume ? { volume: validVolume } : {}),
      title, language: lang, scanlationGroup: safeText(row?.group?.name) || null,
      releaseDateMillis: dateMillis(row?.created_at ?? parent?.created_at),
    });
  }
  for (const row of rows) {
    if (grouped) {
      if (!Array.isArray(row?.translations) || row.translations.length > 64) {
        throw new Error("MangaAll invalid API response");
      }
      for (const translation of row.translations) add(translation, row);
    } else {
      add(row);
    }
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
  if (!chapter) throw new Error("MangaAll work mismatch");
  if (chapter.title_id != null) {
    if (String(chapter.title_id) !== workId) throw new Error("MangaAll work mismatch");
  } else {
    // The public ChapterDetailDto allows title_id=null. A naked chapter
    // identifier is not proof of work ownership. Validate membership in the
    // selected work's chapter listing instead of discarding a safe reader
    // option or exposing pages belonging to a different canonical work.
    const inventory = await chapters({ binding: input.binding });
    if (!inventory.items.some(item => item.providerChapterId === source + ":" + chapterId)) {
      throw new Error("MangaAll work mismatch");
    }
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
