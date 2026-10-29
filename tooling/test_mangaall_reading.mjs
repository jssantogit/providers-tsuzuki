import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve("providers");
const modules = {};
for (const [id, dir, file] of [
  ["mangadex", "mangaall-dex", "mangadex"],
  ["mangaball", "mangaall-ball", "mangaball"],
  ["mangadot", "mangaall-dot", "mangadot"],
]) {
  modules[id] = await import(pathToFileURL(path.join(root, dir, "modules", file + ".js")).href);
  assert.equal(typeof modules[id].pages, "function", "source needs a Reader page adapter");
}
const requests = [];
let fixture;
globalThis.tsuzuki = {
  http: {
    async request(method, url, headersJson) {
      requests.push({ method, url, headers: JSON.parse(headersJson) });
      return JSON.stringify(fixture({ method, url }));
    },
  },
};
const reply = (body) => ({ statusCode: 200, body: JSON.stringify(body) });
const mangaId = "11111111-2222-4333-8444-555555555555";
const chapterId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const hashes = "a".repeat(32);

fixture = () => reply({
  result: "ok", baseUrl: "https://uploads.mangadex.org",
  chapter: { hash: hashes, data: ["page-001.jpg", "page-002.png"], dataSaver: [] },
});
const dex = await modules.mangadex.pages({
  binding: { externalWorkId: "mangadex:" + mangaId },
  providerChapterId: "mangadex:" + chapterId,
});
assert.deepEqual(dex, {
  type: "page_list",
  pages: [
    { url: "https://uploads.mangadex.org/data/" + hashes + "/page-001.jpg", headers: {} },
    { url: "https://uploads.mangadex.org/data/" + hashes + "/page-002.png", headers: {} },
  ],
});
assert.equal(new URL(requests.at(-1).url).pathname, "/at-home/server/" + chapterId);
fixture = () => reply({
  result: "ok", baseUrl: "https://malicious.example",
  chapter: { hash: hashes, data: ["page-001.jpg"] },
});
await assert.rejects(modules.mangadex.pages({
  binding: { externalWorkId: "mangadex:" + mangaId },
  providerChapterId: "mangadex:" + chapterId,
}), /untrusted (image|page) origin/i);

fixture = () => reply({
  data: { chapter: { title_id: "416", pages: [
    "https://mangaball.com/static/page-1.jpg",
    "https://mangaball.com/static/page-2.png",
  ] } },
});
const ball = await modules.mangaball.pages({
  binding: { externalWorkId: "mangaball:416" },
  providerChapterId: "mangaball:9001",
});
assert.equal(new URL(requests.at(-1).url).pathname, "/api/v1/chapter-detail");
assert.equal(new URL(requests.at(-1).url).searchParams.get("chapter_id"), "9001");
assert.deepEqual(ball, {
  type: "page_list",
  pages: [
    { url: "https://mangaball.com/static/page-1.jpg", headers: { Referer: "https://mangaball.com" } },
    { url: "https://mangaball.com/static/page-2.png", headers: { Referer: "https://mangaball.com" } },
  ],
});
fixture = () => reply({ data: { chapter: {
  title_id: "wrong-work", pages: ["https://mangaball.com/static/page-1.jpg"],
} } });
await assert.rejects(modules.mangaball.pages({
  binding: { externalWorkId: "mangaball:416" }, providerChapterId: "mangaball:9001",
}), /work mismatch/i);
fixture = () => reply({ data: { chapter: { title_id: "416", pages: ["https://untrusted.example/img.jpg"] } } });
await assert.rejects(modules.mangaball.pages({
  binding: { externalWorkId: "mangaball:416" }, providerChapterId: "mangaball:9001",
}), /untrusted (image|page) origin/i);

fixture = () => reply({
  manga: { id: 317 },
  images: [{ url: "/pages/001.jpg" }, { url: "https://mangadot.net/pages/002.jpg" }],
});
const dot = await modules.mangadot.pages({
  binding: { externalWorkId: "mangadot:317" },
  providerChapterId: "mangadot:uploads:8001",
});
assert.equal(new URL(requests.at(-1).url).pathname, "/api/uploads/8001/images");
assert.deepEqual(dot, {
  type: "page_list",
  pages: [
    { url: "https://mangadot.net/pages/001.jpg", headers: { Referer: "https://mangadot.net/chapter/8001?source=user" } },
    { url: "https://mangadot.net/pages/002.jpg", headers: { Referer: "https://mangadot.net/chapter/8001?source=user" } },
  ],
});
fixture = () => reply({ manga: { id: 317 }, images: [{ url: "//untrusted.example/x.jpg" }] });
await assert.rejects(modules.mangadot.pages({
  binding: { externalWorkId: "mangadot:317" }, providerChapterId: "mangadot:uploads:8001",
}), /untrusted (image|page) origin/i);
fixture = () => reply({ manga: { id: 999 }, images: [{ url: "/pages/1.jpg" }] });
await assert.rejects(modules.mangadot.pages({
  binding: { externalWorkId: "mangadot:317" }, providerChapterId: "mangadot:uploads:8001",
}), /work mismatch/i);
await assert.rejects(modules.mangadot.pages({
  binding: { externalWorkId: "mangadot:317" }, providerChapterId: "mangadot:other:8001",
}), /invalid chapter id/i);
console.log("MangaAll three-source Reader metadata, identity and origin guards: OK");
