import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("providers/nyaa");
const candidateCount = 20;
const expectedPageSize = 6;

function infoHashFor(index) {
  return index.toString(16).padStart(40, "0");
}

function searchFixture() {
  const items = Array.from({ length: candidateCount }, (_value, offset) => {
    const index = offset + 1;
    const infoHash = infoHashFor(index);
    return `
    <item>
      <title>Bounded Enrichment Chapter 12 Candidate ${index}</title>
      <link>https://nyaa.si/download/${1000 + index}.torrent</link>
      <guid isPermaLink="true">https://nyaa.si/view/${1000 + index}</guid>
      <nyaa:seeders>${30 - index}</nyaa:seeders>
      <nyaa:leechers>1</nyaa:leechers>
      <nyaa:infoHash>${infoHash}</nyaa:infoHash>
      <nyaa:category>Literature - English-translated</nyaa:category>
      <nyaa:size>12 MiB</nyaa:size>
    </item>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa">
  <channel>
    <title>Nyaa</title>${items}
  </channel>
</rss>`;
}

function detailFixture(index) {
  return `<!doctype html><html><body><ul><li><i class="fa fa-file"></i> Bounded Enrichment Chapter 12 Candidate ${index}.cbz <span class="file-size">(12 MiB)</span></li></ul></body></html>`;
}

const rss = searchFixture();
let activeDetailRequests = 0;
let maxActiveDetailRequests = 0;
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
        assert.equal(parsed.searchParams.get("q"), "Bounded Enrichment 12");
        return JSON.stringify({ statusCode: 200, body: rss });
      }

      const detailMatch = parsed.pathname.match(/^\/view\/(\d+)$/);
      if (detailMatch) {
        detailRequests += 1;
        activeDetailRequests += 1;
        maxActiveDetailRequests = Math.max(maxActiveDetailRequests, activeDetailRequests);
        await new Promise((resolve) => setImmediate(resolve));
        activeDetailRequests -= 1;
        const index = Number(detailMatch[1]) - 1000;
        return JSON.stringify({ statusCode: 200, body: detailFixture(index) });
      }

      throw new Error(`Unexpected Nyaa fixture request: ${url}`);
    },
  },
};

const providerModule = await import(pathToFileURL(path.join(root, "main.js")).href);
const provider = providerModule.default;

const recovered = [];
let cursor = null;
let pageCount = 0;

do {
  const detailsBeforePage = detailRequests;
  const result = await provider.torrent.search({
    titles: ["Bounded Enrichment"],
    preferredLanguages: ["en"],
    chapterNumber: "12",
    volume: 1,
    cursor,
  });

  pageCount += 1;
  assert.ok(pageCount <= 8, "bounded enrichment must finish within the Host page limit");
  assert.ok(
    result.items.length <= expectedPageSize,
    `one Provider invocation must enrich at most ${expectedPageSize} candidates`,
  );
  assert.ok(
    detailRequests - detailsBeforePage <= expectedPageSize,
    `one Provider invocation must issue at most ${expectedPageSize} detail requests`,
  );
  for (const item of result.items) {
    assert.equal(item.files?.length, 1, "paged candidates must retain exact-file enrichment");
    recovered.push(item.infoHash);
  }
  cursor = result.nextCursor;
} while (cursor != null);

assert.equal(pageCount, 4, "20 accepted candidates should be split across four bounded pages");
assert.equal(rssRequests, pageCount, "each cursor page should re-run bounded discovery against the same request");
assert.equal(detailRequests, candidateCount, "all accepted candidates must remain eligible for exact Host matching");
assert.equal(new Set(recovered).size, candidateCount, "pagination must not duplicate or drop accepted candidates");
assert.deepEqual(
  recovered,
  Array.from({ length: candidateCount }, (_value, offset) => infoHashFor(offset + 1)),
  "cursor pagination must preserve Nyaa discovery order",
);
assert.ok(maxActiveDetailRequests > 1, "detail enrichment must not remain serial");
assert.ok(
  maxActiveDetailRequests <= expectedPageSize,
  "detail enrichment concurrency must remain bounded by the page size",
);

console.log("Nyaa Provider bounded detail enrichment pagination fixture: OK");
