import { getMangaDexJson, MANGAALL_USER_AGENT } from "./http.js";

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


// Source-verified work details are advisory. They do not establish an
// editorial edition; the Host must independently corroborate creators and
// match exact source chapters before adding Reader choices.
const MAX_EVIDENCE_WORKS = 2;
function normalizedIdentity(value) {
  return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function exactSourceName(candidate, requested) {
  return [candidate.title, ...candidate.aliases]
    .some((name) => normalizedIdentity(name) === normalizedIdentity(requested));
}
async function verifiedWorkEvidence(item, language, includeCoverage) {
  const id = item.externalWorkId.slice(SOURCE.length + 1);
  let details;
  try {
    details = await getMangaDexJson("/manga/" + id, [["includes[]", "author"]]);
  } catch {
    return { detailOutcome: "DETAIL_FAILED" };
  }
  const record = details?.data;
  const names = titleCandidates(record || {});
  if (record?.id?.toLowerCase() !== id || record?.type !== "manga" ||
      !names || ![names.title, ...names.aliases].some((name) =>
        [item.title, ...item.aliases].some((old) =>
          normalizedIdentity(old) === normalizedIdentity(name)))) {
    return { detailOutcome: "IDENTITY_MISMATCH" };
  }
  const authors = [...new Set(record.relationships
    .filter((rel) => rel?.type === "author" && ID_PATTERN.test(rel.id || ""))
    .map((rel) => text(rel.attributes?.name, 128)).filter(Boolean))].slice(0, 8);
  const evidence = {
    detailOutcome: names.aliases.length > 0 ? "VERIFIED_WITH_ALIASES" : "VERIFIED_NO_ALIASES",
    authors,
    aliases: names.aliases,
  };
  if (!includeCoverage || !LANGUAGES.has(language)) return evidence;
  try {
    const page = await getMangaDexJson("/chapter", [
      ["manga", id], ["translatedLanguage[]", language],
      ["contentRating[]", "safe"], ["contentRating[]", "suggestive"],
      ["limit", 2], ["offset", 0],
    ]);
    if (!Number.isInteger(page.total) || page.total < 0 || page.total > 1000000 ||
        page.data.length > 2 || page.data.length > page.total) {
      return { ...evidence, coverageOutcome: "INVALID_RESPONSE" };
    }
    const numbers = [];
    for (const chapter of page.data) {
      if (chapter?.type !== "chapter" || !ID_PATTERN.test(chapter.id || "") ||
          chapter.attributes?.translatedLanguage !== language ||
          chapter.attributes.externalUrl ||
          !Array.isArray(chapter.relationships) ||
          !chapter.relationships.some((relationship) =>
            relationship?.type === "manga" &&
            typeof relationship.id === "string" &&
            relationship.id.toLowerCase() === id)) continue;
      const number = numericChapter(text(chapter.attributes.chapter, 32));
      if (number == null || number < 0 || number * 1000 > 1000000000) continue;
      numbers.push(Math.round(number * 1000));
    }
    if (numbers.length) {
      return { ...evidence, coverageOutcome: "OBSERVED",
        coverageObservedCount: numbers.length,
        coverageMinMilli: Math.min(...numbers), coverageMaxMilli: Math.max(...numbers),
        coverageHasMore: page.total > page.data.length };
    }
    if (page.total === 0) {
      return { ...evidence, coverageOutcome: "EMPTY",
        coverageObservedCount: 0, coverageHasMore: false };
    }
    return { ...evidence, coverageOutcome: "UNKNOWN" };
  } catch {
    return { ...evidence, coverageOutcome: "FAILED" };
  }
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
      // Candidate URL is optional. The Host validates it against manifest
      // permissions, and mangadex.org is intentionally not a browser grant.
      // Keep the verified source identity without silently expanding grants.
      url: null,
      // MangaDex titles are multilingual; facets constrain chapters, not work identity.
      language: null,
    });
  }
  // Only the exact source-title contenders can receive work-level author
  // and first-page coverage evidence. This is bounded and opt-in; an API
  // failure never converts a healthy search result into an empty catalog.
  if (input?.editorialEvidenceVersion === 1) {
    const requestedLanguage = input?.requestedLanguage;
    const contenders = items.filter((item) => exactSourceName(item, title))
      .slice(0, MAX_EVIDENCE_WORKS);
    for (const candidate of contenders) {
      Object.assign(candidate, await verifiedWorkEvidence(
        candidate, requestedLanguage, input?.coverageEvidenceVersion === 1,
      ));
    }
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
  const names = [], seen = new Set();
  for (const item of relationships) {
    if (item?.type !== "scanlation_group") continue;
    const name = text(item?.attributes?.name, 256);
    if (!name || seen.has(name)) continue;
    const next = [...names, name].join(", ");
    if (next.length > 4096) break;
    names.push(name);
    seen.add(name);
  }
  return names.length ? names.join(", ") : null;
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

// Development-only Reader adapter. Publication remains gated by attribution,
// scanlation-group removal enforcement and physical Android image delivery.
export async function pages(input) {
  const workId = parseWorkId(input?.binding?.externalWorkId);
  const rawId = input?.providerChapterId;
  if (typeof rawId !== "string" || !rawId.startsWith(SOURCE + ":")) {
    throw new Error("MangaAll invalid chapter ID");
  }
  const chapterId = rawId.slice(SOURCE.length + 1);
  if (!ID_PATTERN.test(chapterId)) throw new Error("MangaAll invalid chapter ID");
  // At-home delivery metadata does not identify the manga. Check the chapter's
  // actual MangaDex relationship before constructing a Reader URL.
  const entity = await getMangaDexJson("/chapter/" + chapterId);
  const related = entity.data?.relationships;
  if (entity.data?.id?.toLowerCase() !== chapterId.toLowerCase() ||
      !Array.isArray(related) ||
      !related.some(rel => rel?.type === "manga" &&
        typeof rel.id === "string" && rel.id.toLowerCase() === workId.toLowerCase())) {
    throw new Error("MangaAll work mismatch");
  }
  // The chapter detail is authoritative for the language of these pages.
  // An indexed chapter in another language cannot be relabelled by a facet.
  const requestedLanguage = input?.binding?.facetId;
  if (!LANGUAGES.has(requestedLanguage) ||
      entity.data?.attributes?.translatedLanguage !== requestedLanguage) {
    throw new Error("MangaAll chapter language mismatch");
  }
  const externalUrl = entity.data?.attributes?.externalUrl;
  // External releases still contribute chapter evidence to ICE, but MangaDex
  // cannot deliver their pages through MangaDex@Home. Do not fabricate pages.
  if (externalUrl != null && (typeof externalUrl !== "string" || externalUrl.trim())) {
    throw new Error("MangaAll external chapter");
  }
  const response = await getMangaDexJson("/at-home/server/" + chapterId, [["forcePort443", "true"]]);
  const base = response.baseUrl;
  // A MangaDex@Home node can return https://host:port/ephemeral-token.
  // Validate the authority and path without relying on the URL global in QuickJS.
  // Do not enable Reader until Host grants for dynamic image origins are proven.
  const match = typeof base === "string" && base.length <= 512
    ? /^https:\/\/([A-Za-z0-9.-]+)(?::([1-9][0-9]{0,4}))?(\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/.exec(base)
    : null;
  const host = match?.[1]?.toLowerCase();
  const labels = host?.split(".");
  const validLabels = labels?.every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
  const port = match?.[2] == null ? null : Number(match[2]);
  const safePath = match?.[3] == null ||
    match[3].split("/").slice(1).every(segment => segment !== "." && segment !== "..");
  if (!match || !validLabels || !safePath ||
      (port != null && port !== 443) ||
      (host !== "uploads.mangadex.org" && !host.endsWith(".mangadex.network"))) {
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
    return { url: base + "/data/" + hash + "/" + file, headers: { "User-Agent": MANGAALL_USER_AGENT } };
  });
  return { type: "page_list", pages };
}
