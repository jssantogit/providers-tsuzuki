// Exact code10 source regression for the REAL Naruto/Bleach failure observed
// during GitHub Actions unified-three-source live smoke 2026-11-21.
// MangaDot may report 32 broad search pages, but the Host has eight V1 pages.
// Source must report a typed, INCONCLUSIVE error before exhausting the Host.
import assert from "node:assert/strict";
import { lookup } from "../providers/mangaall/modules/sources/mangadot/modules/mangadot.js";

let requests = 0;
globalThis.tsuzuki = {http: {async request(method, url, headersJson) {
  const target = new URL(url);
  assert.equal(method, "GET");
  assert.equal(target.origin, "https://mangadot.net");
  assert.equal(target.pathname, "/api/search");
  assert.equal(target.searchParams.get("search"), "Naruto");
  assert.equal(target.searchParams.get("limit"), "56");
  assert.equal(JSON.parse(headersJson).Origin, "https://mangadot.net");
  requests++;
  const page = Number(target.searchParams.get("page"));
  assert.ok([1, 2, 3].includes(page), "source must never issue a fourth upstream page");
  const body = {
    manga_list: [{ manga_id: 317, title: page === 1 ? "Naruto" : "Unrelated Work" }],
    pagination: { current_page: page, total_pages: 32 },
  };
  return JSON.stringify({statusCode: 200, body: JSON.stringify(body)});
}}};

let cursor = null;
for (let page = 1; page <= 3; page++) {
  const result = await lookup({
    titles: ["Naruto"], ...(cursor == null ? {} : {cursor}),
  });
  assert.equal(result.items.length, 1, "source row remains source evidence only");
  assert.equal(result.nextCursor, String(page + 1));
  cursor = result.nextCursor;
}
assert.equal(cursor, "4");
await assert.rejects(lookup({titles: ["Naruto"], cursor}), /bounded source search exhausted/,
  "a fourth MangaDot page must fail inconclusive instead of silently claiming empty");
assert.equal(requests, 3, "only 3 upstream metadata requests are allowed");
await assert.rejects(lookup({titles: ["Naruto"], cursor: "33"}), /bounded source search exhausted/,
  "arbitrary future cursor cannot revive 32-page broad lookup");
assert.equal(requests, 3, "invalid/bounded cursors must not access the network");
console.log("MangaALL MangaDot 32-page broad search bounded before Host 8-page limit: PASS");
