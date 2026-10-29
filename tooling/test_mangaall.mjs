import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("providers/mangaall");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.id, "app.tsuzuki.mangaall");
assert.equal(manifest.name, "MangaAll");
assert.deepEqual(
  manifest.capabilities.map(({ id }) => id),
  ["reading.lookup", "reading.chapters"],
  "MangaAll initially produces evidence, not Reader pages",
);
assert.deepEqual(manifest.permissions.network.origins, ["https://api.mangadex.org"]);
assert.equal(manifest.permissions.storage.enabled, false);

const { SOURCES } = await import(pathToFileURL(path.join(root, "modules/sources.js")).href);
assert.deepEqual(
  SOURCES.map(({ id }) => id),
  ["mangalivre", "mangadex", "mangafire", "mangaball", "mangadot", "animexnovel", "mangaflix"],
);
assert.deepEqual(SOURCES.filter((source) => source.enabled).map((source) => source.id), ["mangadex"]);

const mangaId = "11111111-2222-4333-8444-555555555555";
const chapterId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const requests = [];
let nextReply;
globalThis.tsuzuki = {
  http: {
    async request(method, url, headersJson) {
      requests.push({ method, url, headers: JSON.parse(headersJson) });
      assert.equal(method, "GET");
      assert.equal(new URL(url).origin, "https://api.mangadex.org");
      assert.equal(JSON.parse(headersJson).Accept, "application/json");
      if (!nextReply) throw new Error("Unexpected HTTP request");
      return JSON.stringify(nextReply());
    },
  },
};

const { default: mangaAll } = await import(pathToFileURL(path.join(root, "main.js")).href);
assert.equal(typeof mangaAll.reading.lookup, "function");
assert.equal(typeof mangaAll.reading.chapters, "function");
assert.equal(mangaAll.reading.pages, undefined, "do not advertise unsupported Reader delivery");

function response(body, statusCode = 200) {
  return { statusCode, body: JSON.stringify(body) };
}
const manga = {
  id: mangaId,
  type: "manga",
  attributes: {
    title: { en: "Haikyu!!" },
    altTitles: [{ en: "Haikyuu!!" }, { ja: "ハイキュー!!" }],
    originalLanguage: "ja",
  },
};
nextReply = () => response({ result: "ok", data: [manga], limit: 20, offset: 0, total: 1 });
const found = await mangaAll.reading.lookup({ titles: ["Haikyuu!!"] });
assert.deepEqual(found, {
  items: [{
    externalWorkId: "mangadex:" + mangaId,
    title: "Haikyu!!",
    aliases: ["Haikyuu!!", "ハイキュー!!"],
    url: "https://mangadex.org/title/" + mangaId,
    language: null,
  }],
  nextCursor: null,
});
assert.equal(new URL(requests[0].url).searchParams.get("title"), "Haikyuu!!");

const chapter = {
  id: chapterId,
  type: "chapter",
  attributes: {
    chapter: "1.5",
    title: "Opening",
    translatedLanguage: "en",
    publishAt: "2026-01-01T00:00:00+00:00",
  },
  relationships: [{ id: "33333333-3333-4333-8333-333333333333", type: "scanlation_group", attributes: { name: "Team A" } }],
};
nextReply = () => response({
  result: "ok", data: [chapter, {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    type: "chapter",
    attributes: { chapter: null, translatedLanguage: "en" },
  }], total: 2, offset: 0, limit: 100,
});
const chapters = await mangaAll.reading.chapters({
  binding: { providerId: manifest.id, facetId: "en", externalWorkId: "mangadex:" + mangaId },
  cursor: null,
});
assert.deepEqual(chapters, {
  items: [{
    providerChapterId: "mangadex:" + chapterId,
    rawLabel: "Ch. 1.5 - Opening",
    rawNumber: 1.5,
    title: "Opening",
    language: "en",
    scanlationGroup: "Team A",
    releaseDateMillis: Date.parse("2026-01-01T00:00:00+00:00"),
  }],
  nextCursor: null,
});
assert.equal(new URL(requests.at(-1).url).searchParams.get("translatedLanguage[]"), "en");
assert.equal(new URL(requests.at(-1).url).searchParams.get("manga"), mangaId);

nextReply = () => response({ result: "ok", data: [], total: 0, offset: 0, limit: 100 });
const portuguese = await mangaAll.reading.chapters({
  binding: { providerId: manifest.id, facetId: "pt-br", externalWorkId: "mangadex:" + mangaId },
});
assert.deepEqual(portuguese, { items: [], nextCursor: null });
assert.equal(new URL(requests.at(-1).url).searchParams.get("translatedLanguage[]"), "pt-br");

await assert.rejects(
  mangaAll.reading.chapters({ binding: { facetId: "en", externalWorkId: "mangafire:" + mangaId } }),
  /unsupported source/i,
);
await assert.rejects(
  mangaAll.reading.chapters({ binding: { facetId: "fr", externalWorkId: "mangadex:" + mangaId } }),
  /unsupported language/i,
);
await assert.rejects(
  mangaAll.reading.chapters({ binding: { facetId: "en", externalWorkId: "mangadex:" + mangaId }, cursor: "NaN" }),
  /invalid cursor/i,
);
nextReply = () => ({ statusCode: 200, body: "<html>challenge</html>" });
await assert.rejects(mangaAll.reading.lookup({ titles: ["Haikyuu!!"] }), /invalid json/i);
nextReply = () => response({ message: "Rate limited" }, 429);
await assert.rejects(mangaAll.reading.lookup({ titles: ["Haikyuu!!"] }), /http 429/i);
nextReply = () => response({ result: "error", errors: [{ detail: "server error" }] });
await assert.rejects(mangaAll.reading.lookup({ titles: ["Haikyuu!!"] }), /invalid api response/i);

console.log("MangaAll source routing, MangaDex evidence and fail-closed fixtures: OK");
