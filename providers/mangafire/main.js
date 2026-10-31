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
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

// Used only to decide whether optional identity detail enrichment is needed.
// The Host remains the sole authority for accepting an editorial edition.
const EDITION_HINTS = ["colored", "coloured", "full color", "full colour", "omnibus", "one shot", "oneshot", "special edition"];
function hasSourceEditionQualifier(item) {
  const base = normalizedTitle(item?.title);
  if (!base) return false;
  return explicitAliases(item).some((alias) => {
    const normalized = normalizedTitle(alias);
    const suffix = normalized.slice(base.length);
    return normalized.startsWith(base) &&
      (suffix.startsWith(" ") || suffix.startsWith("(") || suffix.startsWith("[")) &&
      EDITION_HINTS.some((hint) => suffix.includes(hint));
  });
}

async function verifiedLookupAliases(item, requestedTitle, remainingDetails, forcePrimaryDetail = false) {
  const direct = explicitAliases(item);
  if (!forcePrimaryDetail &&
      (direct.length > 0 || normalizedTitle(item?.title) === normalizedTitle(requestedTitle))) {
    return { aliases: direct, detailsUsed: 0, detailOutcome: "NOT_NEEDED" };
  }
  if (remainingDetails <= 0) {
    return { aliases: direct, detailsUsed: 0, detailOutcome: "BUDGET_EXHAUSTED" };
  }
  const hid = cleanText(item?.hid);
  if (!hid) return { aliases: direct, detailsUsed: 0, detailOutcome: "IDENTITY_MISMATCH" };
  try {
    const response = await titleDetails(hid);
    // A detail response is accepted only when its primary title corroborates
    // the search hit. If it disagrees, do not attach potentially foreign aliases.
    const record = response?.data;
    if (!record || !cleanText(record.title)) {
      return { aliases: direct, detailsUsed: 1, detailOutcome: "INVALID_RESPONSE" };
    }
    if ((cleanText(record.hid) && cleanText(record.hid) !== hid) ||
      normalizedTitle(record.title) !== normalizedTitle(item.title)) {
      return { aliases: direct, detailsUsed: 1, detailOutcome: "IDENTITY_MISMATCH" };
    }
    const aliases = [...new Set([...direct, ...explicitAliases(record)])].slice(0, MAX_ALIASES);
    return {
      aliases,
      detailsUsed: 1,
      detailOutcome: aliases.length > 0 ? "VERIFIED_WITH_ALIASES" : "VERIFIED_NO_ALIASES",
    };
  } catch (error) {
    // A failing optional detail lookup cannot create a false work binding.
    // Only closed reasons and a verified HTTP status are allowed to cross the
    // Provider boundary. Never return upstream error messages or response bodies.
    const statusMatch = /^MangaFire API request failed with HTTP ([1-5][0-9]{2})$/.exec(cleanText(error?.message));
    const httpStatus = Number.isInteger(error?.httpStatus)
      ? error.httpStatus
      : statusMatch ? Number(statusMatch[1]) : null;
    const challenge = error?.challengeRequired === true || httpStatus === 403;
    return {
      aliases: direct,
      detailsUsed: 1,
      detailOutcome: challenge ? "CHALLENGE_BLOCKED" : "DETAIL_FAILED",
      ...(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
        ? { detailHttpStatus: httpStatus } : {}),
    };
  }
}

// Only the exact MangaFire title route can authorize a direct source selection.
// Never turn an arbitrary URL or a lookalike host into a Provider binding.
function titleIdFromSourceUrl(value) {
  const match = /^https:\/\/mangafire\.to\/title\/([a-z0-9]{2,64})(?:-[a-z0-9]+)*\/?$/i.exec(value);
  return match ? match[1] : null;
}

// Counts must be literal source metadata, not inferred from a search page,
// last chapter number, chapter IDs or the number of visible candidates.
function sourceReportedChapterCount(item) {
  const value = item?.chapterCount ?? item?.chaptersCount;
  return Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
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

function verifiedItems(response, capability) {
  if (!response || !Array.isArray(response.items)) {
    throw new Error(`MangaFire ${capability} invalid items array`);
  }
  return response.items;
}

function mergeChapterVariants(items) {
  const selected = new Map();
  for (const item of items) {
    const rawNumber = item?.number;
    const number = Number(rawNumber);
    if (rawNumber == null || rawNumber === "" || !Number.isFinite(number)) {
      throw new Error("MangaFire chapters invalid items number");
    }
    if (item?.id == null || String(item.id).trim() === "") {
      throw new Error("MangaFire chapters invalid items id");
    }
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

    if (/^https?:\/\//i.test(title)) {
      const requestedId = titleIdFromSourceUrl(title);
      if (!requestedId) throw new Error("MangaFire URL must be an exact HTTPS title link");
      const details = await titleDetails(requestedId);
      const record = details?.data;
      if (!record || cleanText(record.hid) !== requestedId || !cleanText(record.title)) {
        throw new Error("MangaFire identity could not be verified from the source");
      }
      return {
        items: [{
          externalWorkId: requestedId,
          title: cleanText(record.title),
          aliases: explicitAliases(record),
          url: titleUrl(record),
          language: LANGUAGE,
          detailOutcome: explicitAliases(record).length > 0 ? "VERIFIED_WITH_ALIASES" : "VERIFIED_NO_ALIASES",
          ...(sourceReportedChapterCount(record) == null
            ? {}
            : { chapterCount: sourceReportedChapterCount(record) }),
        }],
        nextCursor: null,
      };
    }

    const response = await searchTitles(title);
    const sourceHits = verifiedItems(response, "lookup");
    const query = normalizedTitle(title);
    const attestedMatches = new Set(
      sourceHits
        .filter((item) => cleanText(item?.hid) && cleanText(item?.title))
        .filter((item) =>
          normalizedTitle(item.title) === query ||
          explicitAliases(item).some((alias) => normalizedTitle(alias) === query),
        )
        .map((item) => cleanText(item.hid)),
    );
    // Two or more distinct source-attested exact identities already make
    // automatic edition binding ambiguous. Hydrating unrelated results cannot
    // prove which edition is canonical; save the limited detail budget for a
    // future lookup that might actually disambiguate.
    const ambiguousAttested = attestedMatches.size > 1;
    // Search listings often omit edition aliases even on duplicate primary
    // HIDs. Enrich the exact contenders, not irrelevant search hits, with a
    // strict per-lookup budget. An absent detail response proves no edition.
    const unknownEditionPrimaries = sourceHits
      .filter((item) =>
        cleanText(item?.hid) &&
        normalizedTitle(item?.title) === query &&
        !hasSourceEditionQualifier(item),
      );
    const needsPrimaryDetails = unknownEditionPrimaries.length > 1;
    for (const item of sourceHits) {
      const externalWorkId = cleanText(item?.hid);
      const candidateTitle = cleanText(item?.title);
      if (!externalWorkId || !candidateTitle || seen.has(externalWorkId)) continue;
      seen.add(externalWorkId);
      const detail = ambiguousAttested && !attestedMatches.has(externalWorkId)
        ? { aliases: explicitAliases(item), detailsUsed: 0, detailOutcome: "SKIPPED_IRRELEVANT" }
        : await verifiedLookupAliases(
          item,
          title,
          MAX_ALIAS_DETAIL_LOOKUPS - detailLookups,
          needsPrimaryDetails && normalizedTitle(candidateTitle) === query && !hasSourceEditionQualifier(item),
        );
      detailLookups += detail.detailsUsed;
      items.push({
        externalWorkId,
        title: candidateTitle,
        aliases: detail.aliases,
        detailOutcome: detail.detailOutcome,
        ...(detail.detailHttpStatus == null ? {} : { detailHttpStatus: detail.detailHttpStatus }),
        url: titleUrl(item),
        language: LANGUAGE,
        ...(sourceReportedChapterCount(item) == null
          ? {}
          : { chapterCount: sourceReportedChapterCount(item) }),
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
  const rawItems = verifiedItems(response, "chapters");
  const result = [];
  // Some MangaFire responses include multiple chapter languages even when the
  // request asks for one facet. Never relabel a foreign chapter as English or
  // prefer it while deduplicating official/fan versions of the same number.
  const facetItems = rawItems.filter((item) => {
    const sourceLanguage = cleanText(item?.language).toLowerCase();
    return !sourceLanguage || sourceLanguage === language;
  });
  for (const item of mergeChapterVariants(facetItems)) {
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
  const lastPage = meta.lastPage == null ? null : Number(meta.lastPage);
  const hasLastPage = Number.isInteger(lastPage) && lastPage >= page;
  // Never treat absent/malformed pagination metadata as proof of completeness.
  // In that case continue until the source returns an explicitly empty page.
  // Host collection still bounds the total number of pages and elapsed time.
  if (meta.hasNext === false && hasLastPage && page < lastPage) {
    throw new Error("MangaFire chapters conflicting pagination metadata");
  }
  const hasNext = typeof meta.hasNext === "boolean"
    ? meta.hasNext
    : hasLastPage
      ? page < lastPage
      : rawItems.length > 0;
  return {
    items: result,
    nextCursor: hasNext ? String(page + 1) : null,
  };
}

async function pages(input) {
  const providerChapterId = cleanText(input?.providerChapterId);
  if (!providerChapterId) throw new Error("MangaFire page request is missing providerChapterId");

  const binding = input?.binding ?? {};
  const externalWorkId = cleanText(binding.externalWorkId);
  const language = cleanText(binding.facetId) || LANGUAGE;
  if (!externalWorkId || language !== LANGUAGE) {
    throw new Error("MangaFire chapter page request has no valid English work binding");
  }

  const response = await pagesForChapter(providerChapterId);
  const data = response?.data;
  if (!data || typeof data !== "object") {
    throw new Error("MangaFire pages response is missing chapter data");
  }
  // The API may omit optional chapter fields. Whenever it does provide work,
  // chapter or language identity, contradictory fields must fail closed
  // rather than supply an unrelated page sequence to the canonical Reader.
  if (data.id != null && String(data.id) !== providerChapterId) {
    throw new Error("MangaFire pages chapter identity mismatch");
  }
  if (cleanText(data.language) && cleanText(data.language).toLowerCase() !== language) {
    throw new Error("MangaFire pages chapter language mismatch");
  }
  // The upstream may also expose numeric database IDs (mangaId/titleId)
  // that are not in the same namespace as the public MangaFire HID.
  // Compare only explicit HID fields against our externally verified work.
  const reportedWorkIds = [
    data.mangaHid, data.titleHid, data.workHid,
    data.manga?.hid, data.title?.hid, data.work?.hid,
  ].filter((value) => value != null && String(value).trim());
  if (reportedWorkIds.some((id) => String(id) !== externalWorkId)) {
    throw new Error("MangaFire pages work identity mismatch");
  }
  const pageItems = data.pages ?? [];
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
