/*
 * Portions adapted from the MangaFire extension in keiyoushi/extensions-source
 * (Apache-2.0), substantially modified for the Tsuzuki Provider Platform.
 * See assets/THIRD_PARTY_NOTICES.txt.
 */

import { BASE_URL, chaptersForTitle, pagesForChapter, searchTitles, titleDetails } from "./modules/api.js";

const LANGUAGE = "en";
const MAX_LOOKUP_TITLES = 3;
const MAX_LOOKUP_RESULTS = 20;
const MAX_ALIAS_DETAIL_LOOKUPS = 5;
const MAX_ALIASES = 32;

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Never synthesize an alias from similar spelling. Only the source's own
// explicitly supplied title metadata can attest a different canonical name.
function explicitAliases(item) {
  const values = [item?.aliases, item?.alternativeTitles, item?.altTitles, item?.otherNames, item?.synonyms];
  const names = [];
  for (const value of values) {
    const entries = Array.isArray(value) ? value : [];
    for (const entry of entries) {
      const name = cleanText(typeof entry === "string" ? entry : entry?.title ?? entry?.name);
      if (name && name.length <= 1024 && !names.includes(name)) names.push(name);
      if (names.length >= MAX_ALIASES) return names;
    }
  }
  return names;
}

function normalizedTitle(value) {
  return cleanText(value).toLowerCase().replace(/\\s+/g, " ");
}

async function verifiedLookupAliases(item, requestedTitle, remainingDetails) {
  const direct = explicitAliases(item);
  if (direct.length > 0 || normalizedTitle(item?.title) === normalizedTitle(requestedTitle) || remainingDetails <= 0) {
    return { aliases: direct, detailsUsed: 0 };
  }
  const hid = cleanText(item?.hid);
  if (!hid) return { aliases: direct, detailsUsed: 0 };
  try {
    const response = await titleDetails(hid);
    // A detail response is accepted only when its primary title corroborates
    // the search hit. If it disagrees, do not attach potentially foreign aliases.
    const record = response?.data;
    if (!record || normalizedTitle(record.title) !== normalizedTitle(item.title)) {
      return { aliases: direct, detailsUsed: 1 };
    }
    return { aliases: explicitAliases(record), detailsUsed: 1 };
  } catch {
    // A failing optional detail lookup cannot create a false work binding.
    return { aliases: direct, detailsUsed: 1 };
  }
}

function titleUrl(item) {
  const hid = cleanText(item.hid);
  const slug = cleanText(item.slug);
  return `${BASE_URL}/title/${hid}${slug ? `-${slug}` : ""}`;
}

function preferChapterVariant(candidate, current) {
  const candidateOfficial = cleanText(candidate?.type).toLowerCase() === "official";
  const currentOfficial = cleanText(current?.type).toLowerCase() === "official";
  if (candidateOfficial !== currentOfficial) return candidateOfficial;

  const candidateCreatedAt = Number(candidate?.createdAt);
  const currentCreatedAt = Number(current?.createdAt);
  if (Number.isFinite(candidateCreatedAt) && Number.isFinite(currentCreatedAt) && candidateCreatedAt !== currentCreatedAt) {
    return candidateCreatedAt > currentCreatedAt;
  }

  return Number(candidate?.id) < Number(current?.id);
}

function mergeChapterVariants(items) {
  const selected = new Map();
  for (const item of items) {
    const number = Number(item?.number);
    if (!Number.isFinite(number)) continue;
    const key = String(number);
    const current = selected.get(key);
    if (current == null || preferChapterVariant(item, current)) {
      selected.set(key, item);
    }
  }
  return Array.from(selected.values());
}

async function lookup(input) {
  const titles = Array.isArray(input?.titles) ? input.titles : [];
  const seen = new Set();
  const items = [];
  let detailLookups = 0;

  for (const rawTitle of titles.slice(0, MAX_LOOKUP_TITLES)) {
    const title = cleanText(rawTitle);
    if (!title) continue;

    const response = await searchTitles(title);
    for (const item of response?.items ?? []) {
      const externalWorkId = cleanText(item?.hid);
      const candidateTitle = cleanText(item?.title);
      if (!externalWorkId || !candidateTitle || seen.has(externalWorkId)) continue;
      seen.add(externalWorkId);
      const detail = await verifiedLookupAliases(item, title, MAX_ALIAS_DETAIL_LOOKUPS - detailLookups);
      detailLookups += detail.detailsUsed;
      items.push({
        externalWorkId,
        title: candidateTitle,
        aliases: detail.aliases,
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
  for (const item of mergeChapterVariants(response?.items ?? [])) {
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
