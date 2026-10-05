import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("providers/nyaa");
const fixture = (name) => fs.readFileSync(path.join(root, "tests/fixtures", name), "utf8");
const searchFixture = fixture("search.xml");
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
        assert.equal(parsed.searchParams.get("q"), "Public Domain Test");
        return JSON.stringify({ statusCode: 200, body: searchFixture });
      }
      if (parsed.pathname === "/view/1234567") {
        return JSON.stringify({ statusCode: 200, body: singleFixture });
      }
      if (parsed.pathname === "/view/7654321") {
        return JSON.stringify({ statusCode: 200, body: multiFixture });
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

assert.equal(requests.length, 3);
console.log("Nyaa Provider torrent.search fixtures: OK");
