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
  if (source.key === "mangadex") {
    assert.deepEqual(manifest.permissions.network.origins, [
      "https://api.mangadex.org", "https://uploads.mangadex.org", "https://*.mangadex.network",
    ]);
  } else {
    assert.deepEqual(manifest.permissions.network.origins, [source.origin]);
  }
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
      if (parsed.origin === "https://mangaball.com") {
        assert.equal(headers["Content-Type"], method === "POST" ? "application/json" : undefined);
        // KeiSource sends its own actual origin, not a borrowed cookie, session,
        // browser fingerprint or external host origin.
        assert.equal(headers.Origin, "https://mangaball.com");
        assert.equal(headers.Referer, "https://mangaball.com/");
      }
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
assert.equal(new URL(calls.at(-1).url).searchParams.get("tag_mode"), "AND");
assert.equal(new URL(calls.at(-1).url).searchParams.get("adult_mode"), "no_18");
// MangaBall's documented response uses current_page/last_page and code=200.
// Empty results on the first page are a valid result, not a parser failure.
reply = () => ok({
  code: 200,
  message: "Get data successfully",
  data: [],
  pagination: { total: 0, limit: 24, start: 0, current_page: 1, last_page: 0 },
});
assert.deepEqual(await ball.lookup({ titles: ["Haikyuu!!"] }), {
  items: [], nextCursor: null,
});
reply = () => ok({
  code: 200,
  data: [works.mangaball],
  pagination: { total: 26, current_page: 1, last_page: 2 },
});
// Search result is not necessarily the edition's canonical display title.
// Resolve a bounded source-verified alternative name before the Host applies
// its safe exact title/alias binding policy.
reply = ({ parsed }) => parsed.pathname === "/api/v1/title/detail/416"
  ? ok({ data: {
    id: "416", name: "Haikyu!!",
    alternateName: ["Haikyuu!!", "ハイキュー!!"],
  } })
  : ok({ data: [{ id: "416", name: "Haikyu!!" }],
    pagination: { current_page: 1, last_page: 1 }, code: 200 });
const aliasCandidate = await ball.lookup({ titles: ["Haikyuu!!"] });
assert.deepEqual(aliasCandidate.items[0].aliases, ["Haikyuu!!", "ハイキュー!!"]);
assert.equal(calls.at(-1).method, "GET");
assert.equal(new URL(calls.at(-1).url).pathname, "/api/v1/title/detail/416");

// Never trust alternative titles from the details of a different work.
reply = ({ parsed }) => parsed.pathname === "/api/v1/title/detail/416"
  ? ok({ data: { id: "999", alternateName: ["Haikyuu!!"] } })
  : ok({ data: [{ id: "416", name: "Haikyu!!" }],
    pagination: { current_page: 1, last_page: 1 }, code: 200 });
const alienAlias = await ball.lookup({ titles: ["Haikyuu!!"] });
assert.deepEqual(alienAlias.items[0].aliases, [],
  "a mismatched details response may not create a false work binding");

reply = () => ok({
  code: 200, data: [works.mangaball],
  pagination: { total: 26, current_page: 1, last_page: 2 },
});
const ballPageOne = await ball.lookup({ titles: ["Haikyuu!!"] });
assert.equal(ballPageOne.nextCursor, "2");
reply = () => ok({
  code: 200, data: [works.mangaball],
  pagination: { total: 26, current_page: 2, last_page: 2 },
});
assert.equal((await ball.lookup({
  titles: ["Haikyuu!!"], cursor: ballPageOne.nextCursor,
})).nextCursor, null);
// A website-level error with HTTP 200 must not be treated as a successful
// complete-empty response that could erase a canonical evidence snapshot.
reply = () => ok({ code: 500, message: "failed", data: [],
  pagination: { current_page: 1, last_page: 1 } });
await assert.rejects(ball.lookup({ titles: ["Haikyuu!!"] }), /invalid api response/i);


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
// Another observed MangaBall chapter-list format groups translations under
// ALL_CHAPTERS. Preserve separate translation IDs; do not collapse same
// chapter number into one synthetic chapter.
reply = ({ body }) => {
  assert.deepEqual(JSON.parse(body), { title_id: "416" });
  return ok({ code: 200, ALL_LANGUAGES: ["en", "pt-br"], ALL_CHAPTERS: [
    { number: "Ch. 12", number_float: 12, title: "Quick Attack",
      translations: [
        { id: "9201", language: "en", name: "Ch. 12 - Quick Attack",
          group: { name: "Scan A" } },
        { id: "9202", language: "en", name: "Ch. 12 - Quick Attack",
          group: { name: "Scan B" } },
        { id: "9203", language: "pt-br", name: "Capítulo 12",
          group: { name: "Tradução C" } },
      ],
    },
    { number: "Extra", number_float: null, translations: [{
      id: "9301", language: "en", name: "Extra: artwork",
    }] },
  ] });
};
const translated = await ball.chapters({
  binding: { facetId: "en", externalWorkId: "mangaball:416" },
});
assert.deepEqual(translated.items.map(ch => [
  ch.providerChapterId, ch.rawNumber, ch.language, ch.scanlationGroup,
]), [
  ["mangaball:9201", 12, "en", "Scan A"],
  ["mangaball:9202", 12, "en", "Scan B"],
]);
const translatedPortuguese = await ball.chapters({
  binding: { facetId: "pt-br", externalWorkId: "mangaball:416" },
});
assert.deepEqual(translatedPortuguese.items.map(ch => [
  ch.providerChapterId, ch.rawNumber, ch.language,
]), [["mangaball:9203", 12, "pt-br"]]);
// Refuse malformed ALL_CHAPTERS instead of silently returning empty evidence.
reply = () => ok({ code: 200, ALL_CHAPTERS: {} });
await assert.rejects(ball.chapters({
  binding: { facetId: "en", externalWorkId: "mangaball:416" },
}), /invalid api response/i);


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
assert.equal(new URL(calls.at(-1).url).searchParams.get("lang"), "en",
  "MangaDot chapters must request the selected facet from the upstream API");

// The public MangaDot DTO also accepts cursor-only pagination metadata.
// The Host cursor remains a bounded page number, never an arbitrary upstream URL.
reply = () => ok({
  manga_list: [works.mangadot],
  pagination: { next_cursor: "another-page" },
});
const cursorFirst = await dot.lookup({ titles: ["Haikyuu!!"], cursor: "1" });
assert.equal(cursorFirst.nextCursor, "2");
assert.equal(new URL(calls.at(-1).url).searchParams.get("page"), "1");
reply = () => ok({ manga_list: [works.mangadot], pagination: { next_cursor: null } });
const cursorLast = await dot.lookup({ titles: ["Haikyuu!!"], cursor: cursorFirst.nextCursor });
assert.equal(new URL(calls.at(-1).url).searchParams.get("page"), "2");
assert.equal(cursorLast.nextCursor, null);

for (const reading of [ball, dot]) {
  reply = () => ({ statusCode: 200, body: "<html>blocked</html>" });
  await assert.rejects(reading.lookup({ titles: ["Haikyuu!!"] }), /invalid json/i);
  reply = () => ok({ error: "rate limited" });
  await assert.rejects(reading.lookup({ titles: ["Haikyuu!!"] }), /invalid api response/i);
  reply = () => ({ statusCode: 429, body: "" });
  await assert.rejects(reading.lookup({ titles: ["Haikyuu!!"] }), /http 429/i);
}

// MangaBall uses pt-BR, which must match Tsuzuki's pt-br facet without
// claiming that an unrelated language is Brazilian Portuguese.
reply = () => ok({ data: [
  { id: "9010", number: 8, lang: "pt-BR", name: "O saque" },
  { id: "9011", number: 9, lang: "en" },
] });
const ballPortuguese = await ball.chapters({
  binding: { facetId: "pt-br", externalWorkId: "mangaball:416" },
});
assert.equal(ballPortuguese.items.length, 1);
assert.equal(ballPortuguese.items[0].language, "pt-br");
assert.equal(ballPortuguese.items[0].providerChapterId, "mangaball:9010");

// MangaDot's documented language field is optional. Preserve "unknown" as
// unknown instead of fabricating an en/pt-br attribution or silently losing
// a readable chapter. Explicit language mismatches still must be filtered.
reply = () => ok([
  { id: 8101, chapter_number: 6, chapter_title: "Unspecified", language: null },
  { id: 8102, chapter_number: 7, chapter_title: "Português", language: "pt-BR" },
  { id: 8103, chapter_number: 8, language: "en" },
]);
const dotPortuguese = await dot.chapters({
  binding: { facetId: "pt-br", externalWorkId: "mangadot:317" },
});
assert.deepEqual(dotPortuguese.items.map(x => [x.providerChapterId, x.language]), [
  ["mangadot:uploads:8101", null],
  ["mangadot:uploads:8102", "pt-br"],
]);
assert.equal(new URL(calls.at(-1).url).searchParams.get("lang"), "pt-br",
  "MangaDot must pass the Brazilian Portuguese facet to chapter discovery");

console.log("MangaAll three isolated sources: discovery, chapter evidence and error contracts OK");
