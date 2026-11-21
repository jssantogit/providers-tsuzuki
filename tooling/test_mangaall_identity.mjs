import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve();
const product = JSON.parse(fs.readFileSync(path.join(root, "mangaall/product.json"), "utf8"));
assert.equal(product.id, "app.tsuzuki.mangaall");
assert.equal(product.name, "MangaAll");
const single = JSON.parse(fs.readFileSync(path.join(root, "providers/mangaall/manifest.json"), "utf8"));
assert.equal(single.id, "app.tsuzuki.mangaall", "MangaAll has one installable identity");
assert.equal(single.name, "MangaAll");
assert.ok(
  (single.publication === "development" && single.version.name === "0.5.5-dev") ||
  (single.publication === "release" && single.version.name === "0.5.5"),
  "only a development candidate or an unmerged promotion branch may carry code10",
);
assert.equal(single.version.code, 10);
const code10LockPath = "review/mangaall-code10/approved-artifact.json";
assert.equal(fs.existsSync(code10LockPath), single.publication === "release",
  "signed-release PR must carry an explicit SHA-pinned operator approval lock");
if (fs.existsSync(code10LockPath)) {
  const approval = JSON.parse(fs.readFileSync(code10LockPath, "utf8"));
  assert.equal(approval.reviewStatus, "approved");
  assert.equal(approval.artifactSha256,
    "bcdfd03ac18c3cfdd0517e08b58dde7efa1f5baa874e93002af28e518860f95f");
}
assert.deepEqual(single.capabilities.map(({ id }) => id), [
  "reading.lookup", "reading.chapters", "reading.pages",
]);
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
assert.deepEqual(Object.keys(discovery), ["mangadex", "mangadot"],
  "paused MangaBall must not be queried during MangaAll discovery");
assert.deepEqual(discovery.mangadex, {
  status: "success", items: [{ externalWorkId: "mangadex:work-1" }], nextCursor: null,
});
assert.equal(Object.hasOwn(discovery, "mangaball"), false,
  "paused MangaBall must not receive even a failed lookup");
assert.deepEqual(discovery.mangadot, {
  status: "success", items: [{ externalWorkId: "mangadot:work-3" }], nextCursor: null,
});
await assert.rejects(gateway.chapters("mangaball", {
  binding: { externalWorkId: "mangaball:work-17" },
}), /paused/i, "MangaAll must not query chapter inventory of a paused source");
await assert.rejects(gateway.pages("mangaball", {
  binding: { externalWorkId: "mangaball:work-17" }, providerChapterId: "mangaball:chapter-17",
}), /paused/i, "MangaAll must not invoke Reader on a paused source");
await assert.rejects(gateway.chapters("mangadot", {
  binding: { externalWorkId: "mangaball:work-17" },
}), /source mismatch/i);
await assert.rejects(gateway.pages("mangadot", {
  binding: { externalWorkId: "mangadot:work-17" }, providerChapterId: "mangadot:chapter-17",
}), /unavailable/i);
await assert.rejects(gateway.chapters("unrecognized", {
  binding: { externalWorkId: "unrecognized:work" },
}), /unknown source/i);

console.log("MangaAll aggregation: MangaDex and MangaDot active, MangaBall preserved but paused; routing isolation OK");
