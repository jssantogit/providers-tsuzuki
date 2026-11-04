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

console.log("MangaAll single-package contract: passed");
