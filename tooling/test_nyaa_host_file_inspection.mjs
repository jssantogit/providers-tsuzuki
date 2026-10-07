import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("providers/nyaa");
const candidateCount = 20;

function infoHashFor(index) {
  return index.toString(16).padStart(40, "0");
}

function fixture() {
  const items = Array.from({ length: candidateCount }, (_value, offset) => {
    const index = offset + 1;
    const infoHash = infoHashFor(index);
    const link = index === 1
      ? `magnet:?xt=urn:btih:${infoHash}`
      : `https://nyaa.si/download/${1000 + index}.torrent`;
    return `
    <item>
      <title>Host Inspection Chapter 12 Candidate ${index}</title>
      <link>${link}</link>
      <guid isPermaLink="true">https://nyaa.si/view/${1000 + index}</guid>
      <nyaa:seeders>${50 - index}</nyaa:seeders>
      <nyaa:leechers>1</nyaa:leechers>
      <nyaa:infoHash>${infoHash}</nyaa:infoHash>
      <nyaa:category>Literature - English-translated</nyaa:category>
      <nyaa:size>12 MiB</nyaa:size>
    </item>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa">
  <channel><title>Nyaa</title>${items}</channel>
</rss>`;
}

let rssRequests = 0;
let detailRequests = 0;

globalThis.tsuzuki = {
  http: {
    async request(method, url) {
      assert.equal(method, "GET");
      const parsed = new URL(url);
      assert.equal(parsed.origin, "https://nyaa.si");
      if (parsed.pathname === "/" && parsed.searchParams.get("page") === "rss") {
        rssRequests += 1;
        assert.equal(parsed.searchParams.get("q"), "Host Inspection 12");
        return JSON.stringify({ statusCode: 200, body: fixture() });
      }
      if (/^\/view\/\d+$/.test(parsed.pathname)) {
        detailRequests += 1;
        throw new Error("host-inspection fast path must not open Nyaa detail pages");
      }
      throw new Error(`Unexpected Nyaa fixture request: ${url}`);
    },
  },
};

const providerModule = await import(pathToFileURL(path.join(root, "main.js")).href);
const provider = providerModule.default;

const result = await provider.torrent.search({
  titles: ["Host Inspection"],
  preferredLanguages: ["en"],
  chapterNumber: "12",
  volume: 1,
  hostFileInspection: true,
});

assert.equal(result.items.length, candidateCount, "Host inspection should return the bounded RSS candidate set in one page");
assert.equal(result.nextCursor, null, "Host inspection should not require Provider detail pagination");
assert.equal(rssRequests, 1, "Host inspection must discover RSS only once");
assert.equal(detailRequests, 0, "Host inspection must not fetch /view detail pages");
assert.equal(new Set(result.items.map((item) => item.infoHash)).size, candidateCount);
assert.equal(
  result.items[0].torrentUrl,
  "https://nyaa.si/download/1001.torrent",
  "Magnet-link RSS items must expose a validated Nyaa .torrent URL for Host inspection",
);
for (let index = 0; index < result.items.length; index += 1) {
  const item = result.items[index];
  assert.equal(item.infoHash, infoHashFor(index + 1));
  assert.equal(item.torrentUrl, `https://nyaa.si/download/${1001 + index}.torrent`);
  assert.equal(item.files, undefined, "Provider fast path delegates file metadata inspection to the Host");
}

console.log("Nyaa Host torrent-file inspection fast-path fixture: OK");
