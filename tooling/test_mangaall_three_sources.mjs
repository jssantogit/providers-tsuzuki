import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const cases = [
  { key: "mangadex", dir: "mangaall-dex", id: "app.tsuzuki.mangaall.mangadex", origin: "https://api.mangadex.org" },
  { key: "mangaball", dir: "mangaall-ball", id: "app.tsuzuki.mangaall.mangaball", origin: "https://mangaball.com" },
  { key: "mangadot", dir: "mangaall-dot", id: "app.tsuzuki.mangaall.mangadot", origin: "https://mangadot.net" },
];
const works = {
  mangaball: { id: "416", slug: "haikyu", name: "Haikyuu!!" },
  mangadot: { manga_id: 317, title: "Haikyuu!!" },
};

for (const source of cases) {
  const dir = path.resolve("providers", source.dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(manifest.id, source.id);
  assert.ok(manifest.name.startsWith("MangaAll"));
  assert.deepEqual(manifest.capabilities.map((v) => v.id), ["reading.lookup", "reading.chapters"]);
  assert.deepEqual(manifest.permissions.network.origins, [source.origin]);
  assert.equal(manifest.permissions.storage.enabled, false);
  assert.deepEqual(manifest.permissions.browser.origins, []);
}

const calls = [];
let reply = () => { throw Error("Unexpected request"); };
globalThis.tsuzuki = {
  http: {
    async request(method, url, headersJson, body) {
      const parsed = new URL(url);
      assert.ok(cases.some((v) => v.origin === parsed.origin), "unexpected network origin");
      const headers = JSON.parse(headersJson);
      calls.push({ method, url, headers, body });
      assert.equal(headers.Accept, "application/json");
      return JSON.stringify(reply({ method, parsed, body }));
    },
  },
};
const loaders = {};
for (const source of cases) {
  const module = await import(pathToFileURL(path.resolve("providers", source.dir, "main.js")).href);
  loaders[source.key] = module.default.reading;
  assert.equal(typeof loaders[source.key].lookup, "function");
  assert.equal(typeof loaders[source.key].chapters, "function");
  assert.equal(loaders[source.key].pages, undefined, "do not promise Reader pages");
}
const ok = (body) => ({ statusCode: 200, body: JSON.stringify(body) });
const ball = loaders.mangaball;
reply = () => ok({ data: [works.mangaball], pagination: { page: 1, total_pages: 1 } });
const ballLookup = await ball.lookup({ titles: ["Haikyuu!!"] });
assert.deepEqual(ballLookup, { items: [{
  externalWorkId: "mangaball:416", title: "Haikyuu!!", aliases: [],
  url: "https://mangaball.com/title-detail/416", language: null,
}], nextCursor: null });
assert.equal(calls.at(-1).method, "GET");
assert.equal(new URL(calls.at(-1).url).pathname, "/api/v1/title/search-advanced");
assert.equal(new URL(calls.at(-1).url).searchParams.get("keyword"), "Haikyuu!!");

reply = ({ method, body }) => {
  assert.equal(method, "POST");
  assert.deepEqual(JSON.parse(body), { title_id: "416" });
  return ok({ data: [{
    id: "9001", name: "Quick Attack", number: 2.5, volume: 1,
    lang: "en", group: { name: "A Team" }, created_at: "2026-09-01T00:00:00Z",
  }, {
    id: "9002", number: 3, volume: 1, lang: "pt-br",
  }, { id: "9003", number: null, lang: "en" }] });
};
const ballChapters = await ball.chapters({
  binding: { providerId: "app.tsuzuki.mangaall.mangaball", facetId: "en", externalWorkId: "mangaball:416" },
});
assert.deepEqual(ballChapters, { items: [{
  providerChapterId: "mangaball:9001", rawLabel: "Vol. 1 Ch. 2.5 Quick Attack",
  rawNumber: 2.5, volume: 1, title: "Quick Attack", language: "en",
  scanlationGroup: "A Team", releaseDateMillis: Date.parse("2026-09-01T00:00:00Z"),
}], nextCursor: null });
await assert.rejects(ball.chapters({ binding: { facetId: "en", externalWorkId: "mangadot:317" } }), /unsupported source/i);

const dot = loaders.mangadot;
reply = () => ok({ manga_list: [works.mangadot], pagination: { current_page: 1, total_pages: 1 } });
const dotLookup = await dot.lookup({ titles: ["Haikyuu!!"] });
assert.deepEqual(dotLookup, { items: [{
  externalWorkId: "mangadot:317", title: "Haikyuu!!", aliases: [],
  url: "https://mangadot.net/manga/317", language: null,
}], nextCursor: null });
assert.equal(new URL(calls.at(-1).url).pathname, "/api/search");
assert.equal(new URL(calls.at(-1).url).searchParams.get("search"), "Haikyuu!!");

reply = () => ok([
  { id: 8001, chapter_number: 4, chapter_title: "Victory", language: "en",
    group_name: "Scan B", date_added: "2026-09-02T00:00:00Z" },
  { id: 8002, chapter_number: 5, language: "pt-br" },
  { id: 8003, chapter_number: null, language: "en" },
]);
const dotChapters = await dot.chapters({ binding: { facetId: "en", externalWorkId: "mangadot:317" } });
assert.deepEqual(dotChapters, { items: [{
  providerChapterId: "mangadot:uploads:8001", rawLabel: "Ch. 4 Victory",
  rawNumber: 4, title: "Victory", language: "en",
  scanlationGroup: "Scan B", releaseDateMillis: Date.parse("2026-09-02T00:00:00Z"),
}], nextCursor: null });
assert.equal(new URL(calls.at(-1).url).pathname, "/api/manga/317/chapters/list");

for (const reading of [ball, dot]) {
  reply = () => ({ statusCode: 200, body: "<html>blocked</html>" });
  await assert.rejects(reading.lookup({ titles: ["Haikyuu!!"] }), /invalid json/i);
  reply = () => ok({ error: "rate limited" });
  await assert.rejects(reading.lookup({ titles: ["Haikyuu!!"] }), /invalid api response/i);
  reply = () => ({ statusCode: 429, body: "" });
  await assert.rejects(reading.lookup({ titles: ["Haikyuu!!"] }), /http 429/i);
}
console.log("MangaAll three isolated sources: discovery, chapter evidence and error contracts OK");
