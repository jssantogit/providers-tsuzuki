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
    ...(source === "mangafire" ? { async pages(req) {
      calls.push(["pages", source, req.providerChapterId, req.binding.externalWorkId]);
      return { type: "page_list", pages: [{
        url: "https://mfcdn.cc/image/1.png", headers: { Referer: "https://mangafire.to" },
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

const binding = (id) => ({ providerId: manifest.id, facetId: "en", externalWorkId: id });
const dex = await reading.chapters({ binding: binding(workIds[0]) });
assert.equal(dex.items[0].providerChapterId, "mangadex:123");
const fire = await reading.chapters({ binding: binding(workIds[2]) });
assert.equal(fire.items[0].providerChapterId, "mangafire:987");
assert.deepEqual(calls.at(-1), ["chapters", "mangafire", "example"]);
const pages = await reading.pages({ binding: binding(workIds[2]), providerChapterId: fire.items[0].providerChapterId });
assert.equal(pages.pages.length, 1);
assert.deepEqual(calls.at(-1), ["pages", "mangafire", "987", "example"]);

await assert.rejects(reading.chapters({ binding: binding("mangaball:416") }), /unknown source|paused/i);
await assert.rejects(reading.chapters({ binding: binding("bad") }), /unknown source|invalid work/i);
await assert.rejects(reading.chapters({ binding: binding("mangafire:") }), /invalid work/i);
await assert.rejects(reading.chapters({ binding: binding(workIds[2].replace("example", "a/b")) }), /invalid work/i);
await assert.rejects(reading.pages({ binding: binding(workIds[2]), providerChapterId: "mangadex:123" }), /chapter source mismatch/i);
await assert.rejects(reading.pages({ binding: binding(workIds[0]), providerChapterId: "mangadex:123" }), /not available/i);
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
const fireKnown = await languageRouter.pages({
  binding: binding(workIds[2]), providerChapterId: "mangafire:987",
});
assert.equal(fireKnown.pages.length, 1);

console.log("MangaAll single-package contract: passed");
