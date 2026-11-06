import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const dir = path.resolve("providers/mangaall");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
assert.equal(manifest.id, "app.tsuzuki.mangaall");
assert.equal(manifest.name, "MangaAll");
assert.equal(manifest.publication, "development", "never publish before Host/Reader physical acceptance");
assert.deepEqual(manifest.capabilities.map((cap) => cap.id), [
  "reading.lookup", "reading.chapters", "reading.pages",
]);
assert.deepEqual(manifest.contentLanguages, ["en", "pt-br"]);
const origins = new Set(manifest.permissions.network.origins);
for (const origin of ["https://api.mangadex.org", "https://mangadot.net", "https://mangafire.to"]) {
  assert.ok(origins.has(origin), "a source must be granted in the single signed manifest");
}

const { createMangaAllReading } = await import(pathToFileURL(path.join(dir, "modules/router.js")).href);
const actual = (await import(pathToFileURL(path.join(dir, "main.js")).href)).default;
assert.deepEqual(Object.keys(actual), ["reading"], "the single SCRIPT entrypoint exports one provider");
for (const capability of ["lookup", "chapters", "pages"]) {
  assert.equal(typeof actual.reading[capability], "function", "missing " + capability + " export");
}

const workIds = ["mangadex:11111111-2222-4333-8444-555555555555", "mangadot:317", "mangafire:example"];
const calls = [];
const adapters = Object.fromEntries(["mangadex", "mangadot", "mangafire"].map((source, i) => [
  source, {
    async lookup(req) {
      calls.push(["lookup", source, req.cursor ?? null]);
      return { items: [{
        externalWorkId: source === "mangafire" ? "example" : workIds[i],
        title: "Example", aliases: [], language: source === "mangafire" ? "en" : null,
      }], nextCursor: source === "mangadex" && req.cursor == null ? "20" : null };
    },
    async chapters(req) {
      calls.push(["chapters", source, req.binding.externalWorkId]);
      return { items: [{ providerChapterId: source === "mangafire" ? "987" : source + ":123",
        rawLabel: "Ch. 1", rawNumber: 1, language: "en" }], nextCursor: null };
    },
    ...(source === "mangafire" || source === "mangadot" ? { async pages(req) {
      calls.push(["pages", source, req.providerChapterId, req.binding.externalWorkId]);
      return { type: "page_list", pages: [{
        url: source === "mangafire" ? "https://mfcdn.cc/image/1.png" : "https://mangadot.net/pages/1.png",
        headers: { Referer: source === "mangafire" ? "https://mangafire.to" : "https://mangadot.net" },
      }] };
    } } : {}),
  },
]));

const reading = createMangaAllReading(adapters);
const page1 = await reading.lookup({ titles: ["Example"] });
assert.deepEqual(page1.items.map(({ externalWorkId }) => externalWorkId), workIds);
assert.ok(page1.nextCursor);
assert.ok(page1.nextCursor.length < 256);
assert.deepEqual(calls.filter(([kind]) => kind === "lookup").map((v) => v[1]),
  ["mangadex", "mangadot", "mangafire"]);
const page2 = await reading.lookup({ titles: ["Example"], cursor: page1.nextCursor });
assert.deepEqual(page2.items.map(({ externalWorkId }) => externalWorkId), [workIds[0]]);
assert.equal(page2.nextCursor, null);
assert.deepEqual(calls.filter(([kind]) => kind === "lookup").slice(3),
  [["lookup", "mangadex", "20"]], "completed sources must not be re-queried");

// A source search can return unrelated ranked hits. Those must not become
// candidates for edition confirmation or pollute automatic source association.
const misleadingLookup = createMangaAllReading({
  mangadot: { async lookup() {
    return { items: [
      { externalWorkId: "mangadot:4827", title: "Patati patata" },
      { externalWorkId: "mangadot:4000", title: "Vagabond" },
      { externalWorkId: "mangadot:4001", title: "Vagabond (Hong Kong Colored Version)" },
    ], nextCursor: null };
  } },
  mangafire: { async lookup() {
    return { items: [{ externalWorkId: "vagabond", title: "Vagabond" }], nextCursor: null };
  } },
  mangadex: { async lookup() { return { items: [], nextCursor: null }; } },
});
assert.deepEqual(
  (await misleadingLookup.lookup({ titles: ["Vagabond"] })).items.map((x) => x.title),
  ["Vagabond", "Vagabond (Hong Kong Colored Version)", "Vagabond"],
  "unrelated titles must not be exposed as source candidates",
);
assert.deepEqual(
  (await misleadingLookup.lookup({ titles: ["Vagabond", "Patati patata"] })).items.map((x) => x.title),
  ["Patati patata", "Vagabond", "Vagabond (Hong Kong Colored Version)", "Vagabond"],
  "an explicit alternative title must remain valid discovery evidence",
);

// Regression: a valid merged search may exceed the SCRIPT runtime's 64 KiB
// response envelope. Page source results without dropping source-scoped work
// identities, and preserve alias/edition evidence instead of truncating it.
const bulkyAliases = Array.from({ length: 6 }, (_, i) =>
  "Example alternative " + i + " " + "x".repeat(950));
const manyDexWorks = Array.from({ length: 20 }, (_, i) => ({
  externalWorkId: "mangadex:source-work-" + i,
  title: "Example",
  aliases: bulkyAliases,
  language: null,
}));
const budgetCalls = [];
const budgeted = createMangaAllReading({
  mangadex: { async lookup(req) {
    budgetCalls.push(["mangadex", req.cursor ?? null]);
    return { items: manyDexWorks, nextCursor: null };
  } },
  mangadot: { async lookup(req) {
    budgetCalls.push(["mangadot", req.cursor ?? null]);
    return { items: [{ externalWorkId: "mangadot:317", title: "Example" }], nextCursor: null };
  } },
  mangafire: { async lookup(req) {
    budgetCalls.push(["mangafire", req.cursor ?? null]);
    return { items: [{ externalWorkId: "fire-example", title: "Example", language: "en" }], nextCursor: null };
  } },
});
const expectedIds = [...manyDexWorks.map(item => item.externalWorkId),
  "mangadot:317", "mangafire:fire-example"];
const recoveredIds = [];
let budgetCursor = null, budgetPages = 0;
do {
  const page = await budgeted.lookup({ titles: ["Example"], cursor: budgetCursor });
  budgetPages++;
  assert.ok(JSON.stringify(page).length < 64 * 1024,
    "one SCRIPT lookup response must fit Host runtime limit");
  recoveredIds.push(...page.items.map(item => item.externalWorkId));
  for (const item of page.items.filter(item => item.externalWorkId.startsWith("mangadex:"))) {
    assert.deepEqual(item.aliases, bulkyAliases,
      "pagination must never discard source-attested aliases or edition hints");
  }
  budgetCursor = page.nextCursor;
  assert.ok(budgetPages <= 8, "Host bounds lookup continuation to eight pages");
} while (budgetCursor);
assert.ok(budgetPages > 1, "fixture must exercise a continuation, not a small page");
assert.equal(new Set(recoveredIds).size, recoveredIds.length,
  "continuation cannot duplicate previously returned source IDs");
assert.deepEqual(recoveredIds.slice().sort(), expectedIds.slice().sort(),
  "every source candidate must survive pagination, regardless of page interleaving");
assert.ok(budgetCalls.filter(([source]) => source === "mangadot").length >= 1);
assert.ok(budgetCalls.filter(([source]) => source === "mangafire").length >= 1);

const binding = (id) => ({ providerId: manifest.id, facetId: "en", externalWorkId: id });
const dex = await reading.chapters({ binding: binding(workIds[0]) });
assert.equal(dex.items[0].providerChapterId, "mangadex:123");
const fire = await reading.chapters({ binding: binding(workIds[2]) });
assert.equal(fire.items[0].providerChapterId, "mangafire:987");
assert.deepEqual(calls.at(-1), ["chapters", "mangafire", "example"]);
const pages = await reading.pages({ binding: binding(workIds[2]), providerChapterId: fire.items[0].providerChapterId });
assert.equal(pages.pages.length, 1);
assert.deepEqual(calls.at(-1), ["pages", "mangafire", "987", "example"]);
const dotPages = await reading.pages({ binding: binding(workIds[1]), providerChapterId: "mangadot:uploads:8001" });
assert.equal(dotPages.pages.length, 1);
assert.deepEqual(calls.at(-1), ["pages", "mangadot", "mangadot:uploads:8001", workIds[1]]);
await assert.rejects(reading.pages({ binding: binding(workIds[1]), providerChapterId: "mangafire:987" }), /chapter source mismatch/i);

await assert.rejects(reading.chapters({ binding: binding("mangaball:416") }), /unknown source|paused/i);
await assert.rejects(reading.chapters({ binding: binding("bad") }), /unknown source|invalid work/i);
await assert.rejects(reading.chapters({ binding: binding("mangafire:") }), /invalid work/i);
await assert.rejects(reading.chapters({ binding: binding(workIds[2].replace("example", "a/b")) }), /invalid work/i);
await assert.rejects(reading.pages({ binding: binding(workIds[2]), providerChapterId: "mangadex:123" }), /chapter source mismatch/i);
await assert.rejects(reading.pages({
  binding: binding(workIds[0]), providerChapterId: "mangadex:123",
}), /pages not available/i, "mock adapter without pages is not a real MangaDex Reader source");
await assert.rejects(reading.lookup({ titles: ["Example"], cursor: "{bad" }), /invalid cursor/i);
await assert.rejects(reading.lookup({ titles: ["Example"], cursor: JSON.stringify({ v: 1, remaining: { evil: "1" } }) }), /invalid cursor/i);
await assert.rejects(reading.lookup({ titles: [] }), /missing title/i);

const fail = () => { throw new Error("upstream unavailable"); };
const degraded = createMangaAllReading({
  mangadex: { lookup: fail }, mangadot: { lookup: fail },
  mangafire: adapters.mangafire,
});
assert.equal((await degraded.lookup({ titles: ["Example"] })).items[0].externalWorkId, workIds[2],
  "an unavailable source cannot suppress healthy reading alternatives");
// A partially failed source must not disappear silently from MangaAll lookup.
// Retry its exact source cursor once while healthy sources remain usable.
let dexAttempts = 0;
const intermittent = createMangaAllReading({
  mangadex: { async lookup(req) {
    dexAttempts++;
    assert.equal(req.cursor ?? null, null);
    if (dexAttempts === 1) throw new Error("temporary MangaDex failure");
    return { items: [{ externalWorkId: workIds[0], title: "Recovered", aliases: ["Example"] }], nextCursor: null };
  } },
  mangadot: { lookup: adapters.mangadot.lookup },
  mangafire: { lookup: adapters.mangafire.lookup },
});
const initialPartial = await intermittent.lookup({ titles: ["Example"] });
assert.deepEqual(initialPartial.items.map((item) => item.externalWorkId),
  [workIds[1], workIds[2]]);
assert.ok(initialPartial.nextCursor, "temporary source failures require a bounded recovery cursor");
const recovered = await intermittent.lookup({ titles: ["Example"], cursor: initialPartial.nextCursor });
assert.deepEqual(recovered.items.map((item) => item.externalWorkId), [workIds[0]]);
assert.equal(recovered.nextCursor, null);
assert.equal(dexAttempts, 2, "recovery re-queries only the failed source");

let alwaysFails = 0;
const boundedFailure = createMangaAllReading({
  mangadex: { async lookup() { alwaysFails++; throw new Error("still unavailable"); } },
  mangadot: { async lookup(req) {
    return { items: [{ externalWorkId: workIds[1], title: "Healthy", aliases: ["Example"] }],
      nextCursor: req.cursor == null ? "next" : null };
  } },
  mangafire: { lookup: adapters.mangafire.lookup },
});
const firstPartial = await boundedFailure.lookup({ titles: ["Example"] });
const secondPartial = await boundedFailure.lookup({ titles: ["Example"], cursor: firstPartial.nextCursor });
assert.equal(secondPartial.nextCursor, null, "retry budget must not create endless pagination");
assert.equal(alwaysFails, 2, "failed source gets exactly one retry");

const down = createMangaAllReading({
  mangadex: { lookup: fail }, mangadot: { lookup: fail }, mangafire: { lookup: fail },
});
await assert.rejects(down.lookup({ titles: ["Example"] }), /all sources failed/i);


// Language is a reading facet, not a provider identity. Enforce it before
// invoking upstream modules and never relabel a chapter from another language.
const languages = [];
const languageRouter = createMangaAllReading({
  mangadex: {
    async chapters(request) {
      languages.push(["mangadex", request.binding.facetId]);
      return { items: [
        { providerChapterId: "mangadex:en-1", rawNumber: 1, language: "en" },
        { providerChapterId: "mangadex:pt-1", rawNumber: 2, language: "pt-br" },
        { providerChapterId: "mangadex:unknown", rawNumber: 3, language: null },
      ], nextCursor: null };
    },
  },
  mangadot: { async chapters(request) {
    languages.push(["mangadot", request.binding.facetId]);
    return { items: [{ providerChapterId: "mangadot:1", rawNumber: 1, language: "pt-br" }], nextCursor: null };
  } },
  mangafire: {
    async chapters(request) {
      languages.push(["mangafire", request.binding.facetId]);
      return { items: [{ providerChapterId: "987", rawNumber: 1, language: "en" }], nextCursor: null };
    },
    async pages(request) {
      languages.push(["mangafire-pages", request.binding.facetId]);
      return { type: "page_list", pages: [{ url: "https://mfcdn.cc/image/1.jpg" }] };
    },
  },
});
const ptBinding = { ...binding(workIds[0]), facetId: "pt-br" };
const ptChapterPage = await languageRouter.chapters({ binding: ptBinding });
assert.deepEqual(ptChapterPage.items.map((item) => [item.providerChapterId, item.language]), [
  ["mangadex:pt-1", "pt-br"], ["mangadex:unknown", null],
], "do not expose English chapters as Portuguese, or relabel unknown language");
const enChapterPage = await languageRouter.chapters({ binding: binding(workIds[0]) });
assert.deepEqual(enChapterPage.items.map((item) => item.providerChapterId),
  ["mangadex:en-1", "mangadex:unknown"]);
await assert.rejects(languageRouter.chapters({
  binding: { ...binding(workIds[0]), facetId: "fr" },
}), /unsupported language/i);
await assert.rejects(languageRouter.chapters({
  binding: { ...binding(workIds[2]), facetId: "pt-br" },
}), /unsupported language/i);
await assert.rejects(languageRouter.pages({
  binding: { ...binding(workIds[2]), facetId: "pt-br" },
  providerChapterId: "mangafire:987",
}), /unsupported language/i);
assert.deepEqual(languages, [
  ["mangadex", "pt-br"], ["mangadex", "en"],
], "rejected facets must not call any upstream adapter");

const foreignOnly = createMangaAllReading({
  mangadex: { async chapters() {
    return {
      items: [{ providerChapterId: "mangadex:en-9", rawNumber: 9, language: "en" }],
      nextCursor: null,
    };
  } },
});
await assert.rejects(foreignOnly.chapters({ binding: ptBinding }), /language mismatch/i,
  "wrong-language-only response must not become a complete empty chapter inventory");

await assert.rejects(languageRouter.chapters({
  binding: { ...binding(workIds[0]), facetId: null },
}), /missing language/i, "unknown language must not silently default to English");
// MangaDex is a full internal Reader source in the development-only package.
// The explicit source ID and language remain immutable throughout routing.
const dexRouted = createMangaAllReading({
  mangadex: { async pages(request) {
    assert.equal(request.binding.externalWorkId, workIds[0]);
    assert.equal(request.binding.facetId, "pt-br");
    assert.equal(request.providerChapterId, "mangadex:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    return { type: "page_list", pages: [{
      url: "https://uploads.mangadex.org/data/" + "a".repeat(32) + "/1.jpg",
    }] };
  } },
});
const realDexId = "mangadex:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const dexRoutedPages = await dexRouted.pages({
  binding: ptBinding, providerChapterId: realDexId,
});
assert.equal(dexRoutedPages.pages.length, 1);
await assert.rejects(dexRouted.pages({
  binding: binding(workIds[1]), providerChapterId: realDexId,
}), /chapter source mismatch|pages not available/i);
await assert.rejects(dexRouted.pages({
  binding: { ...ptBinding, facetId: "ja" }, providerChapterId: realDexId,
}), /unsupported language/i);

const fireKnown = await languageRouter.pages({
  binding: binding(workIds[2]), providerChapterId: "mangafire:987",
});
assert.equal(fireKnown.pages.length, 1);

// A real MangaDot image manifest can omit manga.id. Verify the chapter's
// exact work, endpoint kind, and attested language before exposing image URLs.
const realRequests = [];
let memberLanguage = "pt-br";
let memberWork = "317";
let declaredImageChapter = 8001;
globalThis.tsuzuki = { http: { async request(method, url) {
  realRequests.push(url);
  const pathname = new URL(url).pathname;
  const body = pathname === "/api/uploads/8001/images"
    ? { chapter: { id: declaredImageChapter }, images: [{ url: "/chapters/page1.webp" }] }
    : pathname === "/api/manga/317/chapters/list"
      ? (memberWork === "317" ? [{ id: 8001, source: "user", language: memberLanguage }] : [])
      : null;
  if (method !== "GET" || body === null) throw new Error("unexpected MangaDot request " + pathname);
  return JSON.stringify({ statusCode: 200, body: JSON.stringify(body) });
} } };
const dotBinding = { ...binding(workIds[1]), facetId: "pt-br" };
const verifiedDot = await actual.reading.pages({
  binding: dotBinding, providerChapterId: "mangadot:uploads:8001",
});
assert.equal(verifiedDot.pages.length, 1);
assert.equal(verifiedDot.pages[0].url, "https://mangadot.net/chapters/page1.webp");
assert.deepEqual(realRequests.map(url => new URL(url).pathname), [
  "/api/uploads/8001/images", "/api/manga/317/chapters/list",
], "image metadata without manga.id must be checked against the exact title's chapters");
declaredImageChapter = 8002;
const beforeForeignChapter = realRequests.length;
await assert.rejects(actual.reading.pages({
  binding: dotBinding, providerChapterId: "mangadot:uploads:8001",
}), /chapter mismatch/i, "image manifest must not claim a different chapter");
assert.equal(realRequests.length, beforeForeignChapter + 1,
  "foreign chapter must be rejected before a chapter-list verification request");
declaredImageChapter = 8001;
memberLanguage = "en";
await assert.rejects(actual.reading.pages({
  binding: dotBinding, providerChapterId: "mangadot:uploads:8001",
}), /work mismatch/i, "chapter from another language cannot become Portuguese Reader pages");
memberLanguage = "pt-br";
await assert.rejects(actual.reading.pages({
  binding: dotBinding, providerChapterId: "mangadot:chapters:8001",
}), /work mismatch|unexpected/i, "chapter kind must not cross uploads/chapters endpoints");

// MangaDex can credit several scanlation groups for the SAME reading chapter.
// These are chapter-source credits, not creators from a work-search candidate.
const dexSource = await import(pathToFileURL(path.join(
  dir, "modules/sources/mangadex/modules/mangadex.js"
)).href);
globalThis.tsuzuki = { http: { async request(method, url) {
  assert.equal(method, "GET");
  assert.equal(new URL(url).pathname, "/chapter");
  const body = { result: "ok", offset: 0, total: 2, data: [
    { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", type: "chapter",
      attributes: { chapter: "1", translatedLanguage: "pt-br" },
      relationships: [
        { type: "scanlation_group", attributes: { name: "Group Alpha" } },
        { type: "scanlation_group", attributes: { name: "Group Beta" } },
        { type: "scanlation_group", attributes: { name: "Group Alpha" } },
        { type: "scanlation_group", attributes: {} },
      ],
    },
    { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef", type: "chapter",
      attributes: { chapter: "2", translatedLanguage: "pt-br" },
      relationships: [],
    },
  ] };
  return JSON.stringify({ statusCode: 200, body: JSON.stringify(body) });
} } };
const creditedChapters = await dexSource.chapters({ binding: {
  externalWorkId: workIds[0], facetId: "pt-br",
} });
assert.deepEqual(creditedChapters.items.map(ch => ch.scanlationGroup), [
  "Group Alpha, Group Beta", null,
], "credit all attested chapter groups once; never invent unknown credits");

// Actual MangaDex pages adapter (not a mock): verify source, language, and
// per-chapter MangaDex@Home image metadata on the unified package.
const dexChapterId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const dexWorkId = "11111111-2222-4333-8444-555555555555";
let detailLanguage = "pt-br";
let detailWork = dexWorkId;
const dexRequests = [];
globalThis.tsuzuki = { http: { async request(method, url) {
  assert.equal(method, "GET");
  const path = new URL(url).pathname;
  dexRequests.push(path);
  const body = path === "/chapter/" + dexChapterId
    ? { result: "ok", data: { id: dexChapterId, type: "chapter",
      attributes: { translatedLanguage: detailLanguage },
      relationships: [{ type: "manga", id: detailWork }],
    } }
    : path === "/at-home/server/" + dexChapterId
      ? { result: "ok", baseUrl: "https://uploads.mangadex.org",
        chapter: { hash: "a".repeat(32), data: ["page1.jpg"] } }
      : null;
  if (!body) throw new Error("unexpected MangaDex request " + path);
  return JSON.stringify({ statusCode: 200, body: JSON.stringify(body) });
} } };
const exactDexBinding = { providerId: manifest.id, externalWorkId: workIds[0], facetId: "pt-br" };
const actualDexPages = await actual.reading.pages({
  binding: exactDexBinding, providerChapterId: "mangadex:" + dexChapterId,
});
assert.equal(actualDexPages.pages[0].url,
  "https://uploads.mangadex.org/data/" + "a".repeat(32) + "/page1.jpg");
assert.deepEqual(dexRequests, [
  "/chapter/" + dexChapterId, "/at-home/server/" + dexChapterId,
]);
detailLanguage = "en";
const beforeWrongLanguage = dexRequests.length;
await assert.rejects(actual.reading.pages({
  binding: exactDexBinding, providerChapterId: "mangadex:" + dexChapterId,
}), /chapter language mismatch/i, "MangaDex cannot serve English pages under a Portuguese facet");
assert.equal(dexRequests.length, beforeWrongLanguage + 1,
  "wrong-language chapter must stop before MangaDex@Home");
detailLanguage = "pt-br";
detailWork = "ffffffff-ffff-4fff-8fff-ffffffffffff";
await assert.rejects(actual.reading.pages({
  binding: exactDexBinding, providerChapterId: "mangadex:" + dexChapterId,
}), /work mismatch/i, "foreign MangaDex chapter must be rejected");
await assert.rejects(actual.reading.pages({
  binding: exactDexBinding, providerChapterId: "mangadex:invalid",
}), /invalid chapter ID/i, "invalid MangaDex chapter ID must fail before network");

console.log("MangaAll single-package contract: passed");
