import assert from "node:assert/strict";
import { createHttpBridge, inspectSource } from "./mangaall_live_probe_core.mjs";

const requests = [];
const bridge = createHttpBridge({
  origin: "https://mangadot.net",
  fetchImpl: async (url, opts) => {
    requests.push({ url, opts });
    return { status: 200, text: async () => JSON.stringify({ manga_list: [] }) };
  },
  maxRequests: 2,
  maxResponseBytes: 1024,
});
await assert.rejects(bridge.request("GET", "https://evil.example/api/search", "{}"), /unauthorized origin/i);
await assert.rejects(bridge.request("POST", "https://mangadot.net/api/search",
  JSON.stringify({ Cookie: "session=secret" }), "{}"), /forbidden header/i);
await assert.rejects(bridge.request("DELETE", "https://mangadot.net/api/search", "{}"), /unsupported method/i);
await assert.rejects(bridge.request("GET", "https://mangadot.net/api/search",
  JSON.stringify({ Origin: "https://evil.example" })), /forbidden header/i);
await assert.rejects(bridge.request("GET", "https://mangadot.net/api/search",
  JSON.stringify({ Referer: "https://evil.example/" })), /forbidden header/i);
assert.equal(requests.length, 0, "invalid authority never reaches transport");
const raw = await bridge.request("GET", "https://mangadot.net/api/search?search=Haikyu",
  JSON.stringify({ Referer: "https://mangadot.net/", Origin: "https://mangadot.net" }));
assert.equal(JSON.parse(raw).statusCode, 200);
assert.equal(requests[0].opts.redirect, "manual", "redirects cannot bypass origin grants");
await bridge.request("GET", "https://mangadot.net/api/search", "{}");
await assert.rejects(bridge.request("GET", "https://mangadot.net/api/search", "{}"), /request limit/i);
assert.equal(requests.length, 2);

const oversized = createHttpBridge({
  origin: "https://mangadot.net",
  fetchImpl: async () => ({ status: 200, text: async () => "x".repeat(1025) }),
  maxResponseBytes: 1024,
});
await assert.rejects(oversized.request("GET", "https://mangadot.net/api/search", "{}"),
  /response too large/i);

const title = "Haikyuu!!";
const baseBinding = { facetId: "en", providerId: "app.tsuzuki.mangaall.mangadot" };
const exactCandidate = { title: "Haikyu!!", aliases: ["Haikyuu!!"], externalWorkId: "mangadot:314" };
let chapterCalls = 0, pageCalls = 0;
const adapter = {
  lookup: async () => ({ items: [exactCandidate], nextCursor: null }),
  chapters: async ({ binding }) => {
    chapterCalls++;
    assert.equal(binding.providerId, baseBinding.providerId);
    assert.equal(binding.externalWorkId, exactCandidate.externalWorkId);
    return { items: [{
      providerChapterId: "mangadot:uploads:200",
      rawNumber: 1, language: "en",
    }], nextCursor: null };
  },
  pages: async () => {
    pageCalls++;
    return { type: "page_list", pages: [
      { url: "https://mangadot.net/pages/1.webp", headers: {} },
      { url: "https://mangadot.net/pages/2.webp", headers: {} },
    ] };
  },
};
const valid = await inspectSource({
  sourceId: "mangadot", title, language: "en", providerId: baseBinding.providerId,
  allowedOrigins: ["https://mangadot.net"], adapter,
});
assert.deepEqual(valid, {
  source: "mangadot", outcome: "observed",
  candidateCount: 1, exactMatchCount: 1,
  chapterCount: 1, pageMetadataCount: 2, pagesInsideGrantedOrigins: true,
});
assert.equal(chapterCalls, 1);
assert.equal(pageCalls, 1);

const ambiguous = await inspectSource({
  sourceId: "mangadot", title, language: "en", providerId: baseBinding.providerId,
  allowedOrigins: ["https://mangadot.net"],
  adapter: { ...adapter, lookup: async () => ({ items: [exactCandidate, {
    ...exactCandidate, externalWorkId: "mangadot:315",
  }], nextCursor: null }) },
});
assert.equal(ambiguous.outcome, "ambiguous");
assert.equal(chapterCalls, 1, "never infer identity when title matches multiple editions");

const notFound = await inspectSource({
  sourceId: "mangadot", title, language: "en", providerId: baseBinding.providerId,
  allowedOrigins: ["https://mangadot.net"],
  adapter: { ...adapter, lookup: async () => ({ items: [{
    title: "Another work", aliases: [], externalWorkId: "mangadot:10",
  }], nextCursor: null }) },
});
assert.equal(notFound.outcome, "no_safe_match");

const externalCdn = await inspectSource({
  sourceId: "mangadot", title, language: "en", providerId: baseBinding.providerId,
  allowedOrigins: ["https://mangadot.net"],
  adapter: { ...adapter, pages: async () => ({
    type: "page_list", pages: [{
      url: "https://images.other.example/1.webp", headers: {},
    }],
  }) },
});
assert.equal(externalCdn.outcome, "observed");
assert.equal(externalCdn.pageMetadataCount, 1);
assert.equal(externalCdn.pagesInsideGrantedOrigins, false,
  "metadata is not proof of Reader network authority");

const missingPages = await inspectSource({
  sourceId: "mangadot", title, language: "en", providerId: baseBinding.providerId,
  allowedOrigins: ["https://mangadot.net"],
  adapter: { ...adapter, pages: undefined },
});
assert.equal(missingPages.outcome, "pages_unavailable");

const upstreamError = await inspectSource({
  sourceId: "mangadot", title, language: "en", providerId: baseBinding.providerId,
  allowedOrigins: ["https://mangadot.net"],
  adapter: { ...adapter, lookup: async () => { throw Error("MangaAll HTTP 429 https://private.example"); } },
});
assert.equal(upstreamError.outcome, "upstream_http_429");
assert.equal(upstreamError.phase, "lookup");
const chaptersRejected = await inspectSource({
  sourceId: "mangadot", title, language: "en", providerId: baseBinding.providerId,
  allowedOrigins: ["https://mangadot.net"],
  adapter: { ...adapter, chapters: async () => { throw Error("MangaAll invalid API response"); } },
});
assert.equal(chaptersRejected.phase, "chapters");
assert.equal(chaptersRejected.outcome, "invalid_api_response");
const imagesRejected = await inspectSource({
  sourceId: "mangadot", title, language: "en", providerId: baseBinding.providerId,
  allowedOrigins: ["https://mangadot.net"],
  adapter: { ...adapter, pages: async () => { throw Error("MangaAll untrusted image origin https://private.example"); } },
});
assert.equal(imagesRejected.phase, "pages");
assert.equal(imagesRejected.outcome, "untrusted_image_origin");
assert.equal(imagesRejected.chapterCount, 1);
assert.equal(JSON.stringify(imagesRejected).includes("private.example"), false);
const metadataInvalid = await inspectSource({
  sourceId: "mangadot", title, language: "en", providerId: baseBinding.providerId,
  allowedOrigins: ["https://mangadot.net"],
  adapter: { ...adapter, pages: async () => { throw Error("MangaAll invalid page metadata"); } },
});
assert.equal(metadataInvalid.phase, "pages");
assert.equal(metadataInvalid.outcome, "invalid_page_metadata");

assert.equal(JSON.stringify(upstreamError).includes("private.example"), false);
const externalRelease = await inspectSource({
  sourceId: "mangadot", title, language: "en", providerId: baseBinding.providerId,
  allowedOrigins: ["https://mangadot.net"],
  adapter: { ...adapter, pages: async () => { throw Error("MangaAll external chapter"); } },
});
assert.equal(externalRelease.phase, "pages");
assert.equal(externalRelease.outcome, "external_chapter");
assert.equal(externalRelease.chapterCount, 1);
// MangaDex may return external-only chapters first; do not conclude that
// the entire work is unreadable when a later source-hosted chapter is valid.
const twoChapterProvider = {
  ...adapter,
  chapters: async () => ({ items: [
    { providerChapterId: "mangadot:uploads:100", rawNumber: 1 },
    { providerChapterId: "mangadot:uploads:101", rawNumber: 2 },
  ], nextCursor: null }),
  pages: async ({ providerChapterId }) => {
    if (providerChapterId.endsWith(":100")) throw Error("MangaAll external chapter");
    return { type: "page_list", pages: [
      { url: "https://mangadot.net/pages/101.webp", headers: {} },
    ] };
  },
};
const secondReadable = await inspectSource({
  sourceId: "mangadot", title, language: "en", providerId: baseBinding.providerId,
  allowedOrigins: ["https://mangadot.net"], adapter: twoChapterProvider,
});
assert.equal(secondReadable.outcome, "observed");
assert.equal(secondReadable.chapterCount, 2);
assert.equal(secondReadable.pageMetadataCount, 1);
const externalOnly = await inspectSource({
  sourceId: "mangadot", title, language: "en", providerId: baseBinding.providerId,
  allowedOrigins: ["https://mangadot.net"],
  adapter: { ...twoChapterProvider, pages: async () => {
    throw Error("MangaAll external chapter");
  } },
});
assert.equal(externalOnly.outcome, "external_chapter");
assert.equal(externalOnly.chapterCount, 2);

console.log("MangaAll opt-in live-probe safety and stage reporting fixtures: OK");
