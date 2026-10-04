/*
 * Portions adapted from the MangaFire extension in keiyoushi/extensions-source
 * (Apache-2.0), substantially modified for the Tsuzuki Provider Platform.
 * See assets/THIRD_PARTY_NOTICES.txt.
 */

import { BASE_URL, chaptersForTitle, pagesForChapter, searchTitles } from "./modules/api.js";

const LANGUAGE = "en";
const MAX_LOOKUP_TITLES = 3;
const MAX_LOOKUP_RESULTS = 20;

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function titleUrl(item) {
  const hid = cleanText(item.hid);
  const slug = cleanText(item.slug);
  return `${BASE_URL}/title/${hid}${slug ? `-${slug}` : ""}`;
}

async function lookup(input) {
  const titles = Array.isArray(input?.titles) ? input.titles : [];
  const seen = new Set();
  const items = [];

  for (const rawTitle of titles.slice(0, MAX_LOOKUP_TITLES)) {
    const title = cleanText(rawTitle);
    if (!title) continue;

    const response = await searchTitles(title);
    for (const item of response?.items ?? []) {
      const externalWorkId = cleanText(item?.hid);
      const candidateTitle = cleanText(item?.title);
      if (!externalWorkId || !candidateTitle || seen.has(externalWorkId)) continue;
      seen.add(externalWorkId);
      items.push({
        externalWorkId,
        title: candidateTitle,
        aliases: [],
        url: titleUrl(item),
        language: LANGUAGE,
      });
      if (items.length >= MAX_LOOKUP_RESULTS) break;
    }

    if (items.length > 0) break;
  }

  return { items, nextCursor: null };
}

async function chapters(input) {
  const binding = input?.binding ?? {};
  const externalWorkId = cleanText(binding.externalWorkId);
  if (!externalWorkId) throw new Error("MangaFire binding is missing externalWorkId");

  const language = cleanText(binding.facetId) || LANGUAGE;
  if (language !== LANGUAGE) throw new Error("MangaFire V1 supports only the English facet");

  const page = input?.cursor == null ? 1 : Number.parseInt(String(input.cursor), 10);
  if (!Number.isInteger(page) || page <= 0 || page > 10000) {
    throw new Error("MangaFire chapter cursor is invalid");
  }

  const response = await chaptersForTitle(externalWorkId, language, page);
  const result = [];
  for (const item of response?.items ?? []) {
    const id = item?.id == null ? "" : String(item.id);
    const number = Number(item?.number);
    if (!id || !Number.isFinite(number)) continue;

    const itemName = cleanText(item?.name);
    const numberLabel = String(number);
    result.push({
      providerChapterId: id,
      rawLabel: itemName ? `Ch. ${numberLabel} - ${itemName}` : `Ch. ${numberLabel}`,
      rawNumber: number,
      title: itemName || null,
      language,
      scanlationGroup: cleanText(item?.type) || null,
      releaseDateMillis: Number.isFinite(Number(item?.createdAt)) ? Number(item.createdAt) * 1000 : null,
    });
  }

  const meta = response?.meta ?? {};
  const lastPage = Number(meta.lastPage ?? page);
  const hasNext = meta.hasNext === true || (Number.isFinite(lastPage) && page < lastPage);
  return {
    items: result,
    nextCursor: hasNext ? String(page + 1) : null,
  };
}

async function pages(input) {
  const providerChapterId = cleanText(input?.providerChapterId);
  if (!providerChapterId) throw new Error("MangaFire page request is missing providerChapterId");

  const response = await pagesForChapter(providerChapterId);
  const pageItems = response?.data?.pages ?? [];
  const result = pageItems
    .map((item) => cleanText(item?.url))
    .filter(Boolean)
    .map((url) => ({
      url,
      headers: { Referer: BASE_URL },
    }));

  if (result.length === 0) throw new Error("MangaFire returned no readable pages");
  return { type: "page_list", pages: result };
}

export default {
  reading: {
    lookup,
    chapters,
    pages,
  },
};
