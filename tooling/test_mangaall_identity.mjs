import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve();
const product = JSON.parse(fs.readFileSync(path.join(root, "mangaall/product.json"), "utf8"));
assert.equal(product.id, "app.tsuzuki.mangaall");
assert.equal(product.name, "MangaAll");
assert.equal(fs.existsSync(path.join(root, "providers/mangaall/manifest.json")), false,
  "MangaAll must not be shipped as a MangaDex-only provider");
assert.deepEqual(product.sources.map(({ id }) => id), [
  "mangalivre", "mangadex", "mangafire", "mangaball", "mangadot", "animexnovel", "mangaflix",
]);
for (const [key, folder] of [
  ["mangadex", "mangaall-dex"], ["mangaball", "mangaall-ball"], ["mangadot", "mangaall-dot"],
]) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "providers", folder, "manifest.json"), "utf8"));
  assert.equal(manifest.id, "app.tsuzuki.mangaall." + key);
  assert.equal(manifest.name, "MangaAll / " +
    ({ mangadex: "MangaDex", mangaball: "MangaBall", mangadot: "MangaDot" })[key]);
}
const { createMangaAll } = await import(pathToFileURL(path.join(root, "mangaall/index.js")).href);
const chapter = { providerChapterId: "mangaball:chapter-17", rawNumber: 17 };
const gateway = createMangaAll({
  mangadex: {
    lookup: async () => ({ items: [{ externalWorkId: "mangadex:work-1" }], nextCursor: null }),
    chapters: async () => ({ items: [], nextCursor: null }),
    pages: async () => { throw Error("reader not authorized"); },
  },
  mangaball: {
    lookup: async () => { throw Error("upstream blocked"); },
    chapters: async () => ({ items: [chapter], nextCursor: null }),
    pages: async () => ({ type: "page_list", pages: [{ url: "https://mangaball.com/test.jpg" }] }),
  },
  mangadot: {
    lookup: async () => ({ items: [{ externalWorkId: "mangadot:work-3" }], nextCursor: null }),
    chapters: async () => ({ items: [], nextCursor: null }),
  },
});
const discovery = await gateway.lookupAcross({ titles: ["Haikyuu!!"] });
assert.deepEqual(Object.keys(discovery), ["mangadex", "mangaball", "mangadot"]);
assert.deepEqual(discovery.mangadex, {
  status: "success", items: [{ externalWorkId: "mangadex:work-1" }], nextCursor: null,
});
assert.deepEqual(discovery.mangaball, { status: "error", reason: "source_failed" });
assert.deepEqual(discovery.mangadot, {
  status: "success", items: [{ externalWorkId: "mangadot:work-3" }], nextCursor: null,
});
assert.deepEqual(await gateway.chapters("mangaball", {
  binding: { externalWorkId: "mangaball:work-17" },
}), { items: [chapter], nextCursor: null });
assert.deepEqual(await gateway.pages("mangaball", {
  binding: { externalWorkId: "mangaball:work-17" }, providerChapterId: "mangaball:chapter-17",
}), { type: "page_list", pages: [{ url: "https://mangaball.com/test.jpg" }] });
await assert.rejects(gateway.chapters("mangadot", {
  binding: { externalWorkId: "mangaball:work-17" },
}), /source mismatch/i);
await assert.rejects(gateway.pages("mangadot", {
  binding: { externalWorkId: "mangadot:work-17" }, providerChapterId: "mangadot:chapter-17",
}), /unavailable/i);
await assert.rejects(gateway.chapters("unrecognized", {
  binding: { externalWorkId: "unrecognized:work" },
}), /unknown source/i);

console.log("MangaAll aggregate identity, three independent adapters and reader contract: OK");
