import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("providers/nyaa");
const expectedPageSize = 3;
const maxCursorChars = 4096;

function infoHashFor(index) {
  return index.toString(16).padStart(40, "0");
}

function searchFixture(candidateCount, displayNameFor) {
  const items = Array.from({ length: candidateCount }, (_value, offset) => {
    const index = offset + 1;
    const infoHash = infoHashFor(index);
    return `
    <item>
      <title>${displayNameFor(index)}</title>
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

function detailFixture(displayName) {
  return `<!doctype html><html><body><ul><li><i class="fa fa-file"></i> ${displayName}.cbz <span class="file-size">(12 MiB)</span></li></ul></body></html>`;
}

let scenario = null;
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
        assert.equal(parsed.searchParams.get("q"), scenario.query);
        return JSON.stringify({ statusCode: 200, body: scenario.rss });
      }

      const detailMatch = parsed.pathname.match(/^\/view\/(\d+)$/);
      if (detailMatch) {
        detailRequests += 1;
        activeDetailRequests += 1;
        maxActiveDetailRequests = Math.max(maxActiveDetailRequests, activeDetailRequests);
        await new Promise((resolve) => setImmediate(resolve));
        activeDetailRequests -= 1;
        const index = Number(detailMatch[1]) - 1000;
        return JSON.stringify({ statusCode: 200, body: detailFixture(scenario.displayNameFor(index)) });
      }

      throw new Error(`Unexpected Nyaa fixture request: ${url}`);
    },
  },
};

const providerModule = await import(pathToFileURL(path.join(root, "main.js")).href);
const provider = providerModule.default;

async function runScenario({
  name,
  candidateCount,
  displayNameFor,
  expectedRssRequests,
  expectedPageCount,
  requireSnapshotCursor,
  requireFallbackCursor,
}) {
  scenario = {
    query: "Bounded Enrichment 12",
    displayNameFor,
    rss: searchFixture(candidateCount, displayNameFor),
  };
  activeDetailRequests = 0;
  maxActiveDetailRequests = 0;
  rssRequests = 0;
  detailRequests = 0;

  const recovered = [];
  const cursors = [];
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
    assert.ok(pageCount <= 8, `${name}: bounded enrichment must finish within the Host page limit`);
    assert.ok(
      result.items.length <= expectedPageSize,
      `${name}: one Provider invocation must enrich at most ${expectedPageSize} candidates`,
    );
    assert.ok(
      detailRequests - detailsBeforePage <= expectedPageSize,
      `${name}: one Provider invocation must issue at most ${expectedPageSize} detail requests`,
    );
    for (const item of result.items) {
      const index = Number.parseInt(item.infoHash, 16);
      assert.equal(item.displayName, displayNameFor(index), `${name}: snapshot must preserve display name`);
      assert.equal(item.sizeBytes, 12 * 1024 * 1024, `${name}: snapshot must preserve size`);
      assert.equal(item.seeders, 30 - index, `${name}: snapshot must preserve seeders`);
      assert.equal(item.peers, 1, `${name}: snapshot must preserve peers`);
      assert.deepEqual(item.languages, ["en"], `${name}: snapshot must preserve languages`);
      assert.equal(item.torrentUrl, `https://nyaa.si/download/${1000 + index}.torrent`, `${name}: snapshot must preserve torrent URL`);
      assert.equal(item.files?.length, 1, `${name}: paged candidates must retain exact-file enrichment`);
      recovered.push(item.infoHash);
    }

    cursor = result.nextCursor;
    if (cursor != null) {
      assert.ok(cursor.length <= maxCursorChars, `${name}: Provider cursor must stay within the Host 4096-char bound`);
      cursors.push(cursor);
    }
  } while (cursor != null);

  assert.equal(pageCount, expectedPageCount, `${name}: unexpected page count`);
  assert.equal(rssRequests, expectedRssRequests, `${name}: unexpected RSS discovery count`);
  assert.equal(detailRequests, candidateCount, `${name}: all accepted candidates must remain eligible for exact Host matching`);
  assert.equal(new Set(recovered).size, candidateCount, `${name}: pagination must not duplicate or drop accepted candidates`);
  assert.deepEqual(
    recovered,
    Array.from({ length: candidateCount }, (_value, offset) => infoHashFor(offset + 1)),
    `${name}: cursor pagination must preserve Nyaa discovery order`,
  );
  assert.ok(maxActiveDetailRequests > 1, `${name}: fixture must preserve concurrent Host HTTP behavior observed on device`);
  assert.ok(
    maxActiveDetailRequests <= expectedPageSize,
    `${name}: detail enrichment concurrency must remain bounded by the page size`,
  );
  if (requireSnapshotCursor) {
    assert.ok(cursors.some((value) => value.startsWith("snapshot:")), `${name}: expected a snapshot cursor`);
  }
  if (requireFallbackCursor) {
    assert.ok(cursors.some((value) => value.startsWith("after:")), `${name}: expected bounded fallback to after cursor`);
  }
}

await runScenario({
  name: "normal snapshot",
  candidateCount: 20,
  displayNameFor: (index) => `Bounded Enrichment Chapter 12 Candidate ${index}`,
  expectedRssRequests: 1,
  expectedPageCount: 7,
  requireSnapshotCursor: true,
  requireFallbackCursor: false,
});

await runScenario({
  name: "oversized snapshot fallback",
  candidateCount: 8,
  displayNameFor: (index) => `Bounded Enrichment Chapter 12 Candidate ${index} ${"x".repeat(1750)}`,
  expectedRssRequests: 2,
  expectedPageCount: 3,
  requireSnapshotCursor: true,
  requireFallbackCursor: true,
});

console.log("Nyaa Provider discovery-snapshot pagination fixture: OK");
