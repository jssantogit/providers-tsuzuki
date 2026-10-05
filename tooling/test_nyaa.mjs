import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("providers/nyaa");
const fixture = (name) => fs.readFileSync(path.join(root, "tests/fixtures", name), "utf8");
const searchFixture = fixture("search.xml");
const emptySearchFixture = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa"><channel><title>Nyaa</title></channel></rss>\n`;
const unexpectedSearchFixture = "<!doctype html><html><head><title>Unexpected response</title></head><body>Not RSS</body></html>";
const magnetSearchFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa">
  <channel>
    <title>Nyaa</title>
    <item>
      <title>Magnet Link Test Chapter 1</title>
      <link>magnet:?xt=urn:btih:1111111111111111111111111111111111111111</link>
      <guid isPermaLink="true">https://nyaa.si/view/2468101</guid>
      <nyaa:seeders>4</nyaa:seeders>
      <nyaa:leechers>1</nyaa:leechers>
      <nyaa:downloads>9</nyaa:downloads>
      <nyaa:infoHash>1111111111111111111111111111111111111111</nyaa:infoHash>
      <nyaa:category>Literature - English-translated</nyaa:category>
      <nyaa:size>12 MiB</nyaa:size>
    </item>
  </channel>
</rss>`;
const singleFixture = fixture("single-archive.html");
const multiFixture = fixture("multi-file.html");
const requests = [];

globalThis.tsuzuki = {
  http: {
    async request(method, url, headersJson) {
      requests.push({ method, url, headersJson });
      assert.equal(method, "GET");
      const parsed = new URL(url);
      assert.equal(parsed.origin, "https://nyaa.si");
      if (parsed.pathname === "/" && parsed.searchParams.get("page") === "rss") {
        assert.equal(parsed.searchParams.get("c"), "3_1");
        assert.equal(parsed.searchParams.get("f"), "0");
        const query = parsed.searchParams.get("q");
        if (query === "Public Domain Test 1") {
          return JSON.stringify({ statusCode: 200, body: emptySearchFixture });
        }
        if (query === "Public Domain Test") {
          return JSON.stringify({ statusCode: 200, body: searchFixture });
        }
        if (query === "Missing Primary 1" || query === "Missing Primary") {
          return JSON.stringify({ statusCode: 200, body: emptySearchFixture });
        }
        if (query === "Public Domain Test Alt 1") {
          return JSON.stringify({ statusCode: 200, body: searchFixture });
        }
        if (query === "Unexpected Body 1" || query === "Unexpected Body") {
          return JSON.stringify({ statusCode: 200, body: unexpectedSearchFixture });
        }
        if (query === "Magnet Link Test 1" || query === "Magnet Link Test") {
          return JSON.stringify({ statusCode: 200, body: magnetSearchFixture });
        }
        throw new Error(`Unexpected Nyaa search query: ${query}`);
      }
      if (parsed.pathname === "/view/1234567") {
        return JSON.stringify({ statusCode: 200, body: singleFixture });
      }
      if (parsed.pathname === "/view/7654321") {
        return JSON.stringify({ statusCode: 200, body: multiFixture });
      }
      if (parsed.pathname === "/view/2468101") {
        return JSON.stringify({ statusCode: 200, body: singleFixture });
      }
      throw new Error(`Unexpected Nyaa fixture request: ${url}`);
    },
  },
};

const providerModule = await import(pathToFileURL(path.join(root, "main.js")).href);
const provider = providerModule.default;
assert.equal(typeof provider?.torrent?.search, "function", "missing torrent.search");

const result = await provider.torrent.search({
  titles: ["Public Domain Test", "Public Domain Test Alt"],
  preferredLanguages: ["en"],
  chapterNumber: "1",
  volume: 1,
  cursor: null,
});

assert.equal(result.nextCursor, null, "Nyaa RSS V1 must not pretend to paginate");
assert.equal(result.items.length, 2);

const single = result.items[0];
assert.equal(single.infoHash, "0123456789abcdef0123456789abcdef01234567");
assert.equal(single.torrentUrl, "https://nyaa.si/download/1234567.torrent");
assert.match(single.magnetUri, /^magnet:\?xt=urn:btih:0123456789abcdef0123456789abcdef01234567/);
assert.equal(single.displayName, "Public Domain Test Chapter 1");
assert.equal(single.seeders, 7);
assert.equal(single.peers, 2);
assert.deepEqual(single.languages, ["en"]);
assert.deepEqual(single.files, [
  {
    index: 0,
    path: "Public Domain Test Chapter 1.cbz",
    sizeBytes: 12 * 1024 * 1024,
    languages: ["en"],
  },
]);

const batch = result.items[1];
assert.equal(batch.infoHash, "fedcba9876543210fedcba9876543210fedcba98");
assert.equal(
  batch.files,
  undefined,
  "multi-file Nyaa torrents must fail closed until exact torrent metadata indices are available",
);

assert.deepEqual(
  requests
    .filter(({ url }) => new URL(url).searchParams.get("page") === "rss")
    .map(({ url }) => new URL(url).searchParams.get("q")),
  ["Public Domain Test 1", "Public Domain Test"],
  "chapter-aware discovery must fall back to title-only search when the narrow RSS query is empty",
);
assert.equal(requests.length, 4);

const aliasRequestStart = requests.length;
const aliasResult = await provider.torrent.search({
  titles: ["Missing Primary", "Public Domain Test Alt", "public domain test alt", "Ignored Third"],
  preferredLanguages: ["en"],
  chapterNumber: "1",
  volume: 1,
  cursor: null,
});
assert.equal(aliasResult.items.length, 2, "a later exact canonical title alias must be eligible for discovery");
assert.deepEqual(
  requests
    .slice(aliasRequestStart)
    .filter(({ url }) => new URL(url).searchParams.get("page") === "rss")
    .map(({ url }) => new URL(url).searchParams.get("q")),
  ["Missing Primary 1", "Missing Primary", "Public Domain Test Alt 1"],
  "Nyaa must try exact aliases in order, dedupe case-insensitively, and stop on the first non-empty discovery",
);

const magnetRequestStart = requests.length;
const magnetResult = await provider.torrent.search({
  titles: ["Magnet Link Test"],
  preferredLanguages: ["en"],
  chapterNumber: "1",
  volume: 1,
  cursor: null,
});
assert.equal(
  magnetResult.items.length,
  1,
  "Nyaa RSS items with stable infoHash/guid must not be discarded solely because link is a magnet URI",
);
const magnetCandidate = magnetResult.items[0];
assert.equal(magnetCandidate.infoHash, "1111111111111111111111111111111111111111");
assert.equal(magnetCandidate.torrentUrl, undefined);
assert.match(magnetCandidate.magnetUri, /^magnet:\?xt=urn:btih:1111111111111111111111111111111111111111/);
assert.deepEqual(
  requests
    .slice(magnetRequestStart)
    .filter(({ url }) => new URL(url).searchParams.get("page") === "rss")
    .map(({ url }) => new URL(url).searchParams.get("q")),
  ["Magnet Link Test 1"],
  "a valid narrow RSS item must not be discarded and retried as a false empty search",
);

const unexpectedRequestStart = requests.length;
await assert.rejects(
  () => provider.torrent.search({
    titles: ["Unexpected Body"],
    preferredLanguages: ["en"],
    chapterNumber: "1",
    volume: 1,
    cursor: null,
  }),
  /RSS feed/,
  "HTTP 200 non-RSS documents must not masquerade as an empty Nyaa search",
);
assert.deepEqual(
  requests
    .slice(unexpectedRequestStart)
    .filter(({ url }) => new URL(url).searchParams.get("page") === "rss")
    .map(({ url }) => new URL(url).searchParams.get("q")),
  ["Unexpected Body 1"],
  "an invalid narrow response must fail closed instead of triggering title-only fallback",
);

console.log("Nyaa Provider torrent.search fixtures: OK");
