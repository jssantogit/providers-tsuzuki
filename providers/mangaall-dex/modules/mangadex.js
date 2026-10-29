import { getMangaDexJson } from "./http.js";

const SOURCE = "mangadex";
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGES = new Set(["en", "pt-br"]);
const SEARCH_PAGE_SIZE = 20;
const CHAPTER_PAGE_SIZE = 100;
const MAX_OFFSET = 9900;

function text(value, limit = 1024) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function offsetFromCursor(cursor) {
  if (cursor === undefined || cursor === null) return 0;
  const value = String(cursor);
  if (!/^(0|[1-9][0-9]{0,3})$/.test(value)) throw new Error("MangaAll invalid cursor");
  const offset = Number(value);
  if (offset > MAX_OFFSET) throw new Error("MangaAll invalid cursor");
  return offset;
}

function expectPage(data, offset, size) {
  if (data.offset !== undefined && data.offset !== offset) {
    throw new Error("MangaAll inconsistent page offset");
  }
  if (!Number.isInteger(data.total) || data.total < 0 || data.total > 1000000) {
    throw new Error("MangaAll invalid page total");
  }
  if (data.data.length > size || offset + data.data.length > data.total) {
    throw new Error("MangaAll inconsistent page size");
  }
  const end = offset + data.data.length;
  if (end < data.total && (data.data.length === 0 || end > MAX_OFFSET)) {
    throw new Error("MangaAll incomplete page");
  }
  return end < data.total ? String(end) : null;
}

function preferredTitle(titles) {
  if (!titles || typeof titles !== "object" || Array.isArray(titles)) return "";
  return text(titles.en) || text(titles["ja-ro"]) || text(Object.values(titles).find(
    (value) => typeof value === "string" && value.trim(),
  ));
}

function titleCandidates(item) {
  const attrs = item.attributes || {};
  const title = preferredTitle(attrs.title);
  if (!title || title.length > 1024) return null;
  const aliases = [];
  const seen = new Set([title.toLowerCase()]);
  const sources = [attrs.title].concat(Array.isArray(attrs.altTitles) ? attrs.altTitles : []);
  for (const translation of sources) {
    if (!translation || typeof translation !== "object" || Array.isArray(translation)) continue;
    for (const value of Object.values(translation)) {
      const alias = text(value);
      const key = alias.toLowerCase();
      if (!alias || seen.has(key)) continue;
      seen.add(key);
      aliases.push(alias);
      if (aliases.length === 32) break;
    }
    if (aliases.length === 32) break;
  }
  return { title, aliases };
}

function parseWorkId(value) {
  if (typeof value !== "string" || !value.startsWith(SOURCE + ":")) {
    throw new Error("MangaAll unsupported source");
  }
  const id = value.slice(SOURCE.length + 1);
  if (!ID_PATTERN.test(id)) throw new Error("MangaAll invalid work ID");
  return id;
}

export async function lookup(input) {
  const titles = Array.isArray(input?.titles) ? input.titles : [];
  if (!titles.length) throw new Error("MangaAll missing lookup title");
  const title = text(titles[0]);
  if (!title) throw new Error("MangaAll missing lookup title");
  const offset = offsetFromCursor(input?.cursor);
  const response = await getMangaDexJson("/manga", [
    ["title", title], ["limit", SEARCH_PAGE_SIZE], ["offset", offset],
  ]);
  const nextCursor = expectPage(response, offset, SEARCH_PAGE_SIZE);
  const seen = new Set();
  const items = [];
  for (const item of response.data) {
    if (item?.type !== "manga" || !ID_PATTERN.test(item.id || "") || seen.has(item.id)) continue;
    const titles = titleCandidates(item);
    if (!titles) continue;
    seen.add(item.id);
    items.push({
      externalWorkId: SOURCE + ":" + item.id.toLowerCase(),
      title: titles.title,
      aliases: titles.aliases,
      url: "https://mangadex.org/title/" + item.id.toLowerCase(),
      // MangaDex titles are multilingual; facets constrain chapters, not work identity.
      language: null,
    });
  }
  return { items, nextCursor };
}

function numericChapter(label) {
  if (!/^[0-9]{1,6}(?:\.[0-9]{1,3})?$/.test(label)) return null;
  const number = Number(label);
  return Number.isFinite(number) ? number : null;
}

function groupName(relationships) {
  if (!Array.isArray(relationships)) return null;
  const group = relationships.find((item) => item?.type === "scanlation_group");
  return text(group?.attributes?.name, 4096) || null;
}

function publishedDate(attrs) {
  const raw = attrs.publishAt || attrs.readableAt || attrs.createdAt;
  const timestamp = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

export async function chapters(input) {
  const binding = input?.binding || {};
  const mangaId = parseWorkId(binding.externalWorkId);
  const language = binding.facetId || "en";
  if (!LANGUAGES.has(language)) throw new Error("MangaAll unsupported language");
  const offset = offsetFromCursor(input?.cursor);
  const response = await getMangaDexJson("/chapter", [
    ["manga", mangaId],
    ["translatedLanguage[]", language],
    ["includes[]", "scanlation_group"],
    ["contentRating[]", "safe"],
    ["contentRating[]", "suggestive"],
    ["order[chapter]", "asc"],
    ["limit", CHAPTER_PAGE_SIZE],
    ["offset", offset],
  ]);
  const nextCursor = expectPage(response, offset, CHAPTER_PAGE_SIZE);
  const items = [];
  const seen = new Set();
  for (const item of response.data) {
    const attrs = item?.attributes;
    if (item?.type !== "chapter" || !attrs || !ID_PATTERN.test(item.id || "")) continue;
    if (attrs.translatedLanguage !== language) continue;
    const rawChapter = text(attrs.chapter, 32);
    const number = numericChapter(rawChapter);
    if (number === null || seen.has(item.id)) continue;
    seen.add(item.id);
    const title = text(attrs.title, 4096) || null;
    items.push({
      providerChapterId: SOURCE + ":" + item.id.toLowerCase(),
      rawLabel: "Ch. " + rawChapter + (title ? " - " + title.slice(0, 4000) : ""),
      rawNumber: number,
      title,
      language,
      scanlationGroup: groupName(item.relationships),
      releaseDateMillis: publishedDate(attrs),
    });
  }
  return { items, nextCursor };
}

// Internal Reader prototype. Do not export from main.js or advertise reading.pages
// until image-host grants, MangaDex attribution/removal policy and Android smoke pass.
export async function pages(input) {
  parseWorkId(input?.binding?.externalWorkId);
  const rawId = input?.providerChapterId;
  if (typeof rawId !== "string" || !rawId.startsWith(SOURCE + ":")) {
    throw new Error("MangaAll invalid chapter ID");
  }
  const chapterId = rawId.slice(SOURCE.length + 1);
  if (!ID_PATTERN.test(chapterId)) throw new Error("MangaAll invalid chapter ID");
  const response = await getMangaDexJson("/at-home/server/" + chapterId);
  const base = response.baseUrl;
  if (typeof base !== "string" ||
    !/^https:\/\/(?:uploads\.mangadex\.org|(?:[a-z0-9-]+\.)+mangadex\.network)$/i.test(base)) {
    throw new Error("MangaAll untrusted image origin");
  }
  const chapter = response.chapter;
  const hash = chapter?.hash;
  const files = chapter?.data;
  if (typeof hash !== "string" || !/^[0-9a-f]{16,128}$/i.test(hash) ||
      !Array.isArray(files) || files.length === 0 || files.length > 5000) {
    throw new Error("MangaAll invalid page metadata");
  }
  const pages = files.map((file) => {
    if (typeof file !== "string" || !/^[A-Za-z0-9._-]{1,255}$/.test(file) ||
        file === "." || file === "..") {
      throw new Error("MangaAll invalid page filename");
    }
    return { url: base + "/data/" + hash + "/" + file, headers: {} };
  });
  return { type: "page_list", pages };
}
