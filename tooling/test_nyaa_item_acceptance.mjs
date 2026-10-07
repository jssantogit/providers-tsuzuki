import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const NativeURL = globalThis.URL;
const root = path.resolve("providers/nyaa");
const fixture = (name) => fs.readFileSync(path.join(root, "tests/fixtures", name), "utf8");
const singleFixture = fixture("single-archive.html");
const multiFixture = fixture("multi-file.html");
const emptyRss = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa"><channel><title>Nyaa</title></channel></rss>`;

function rssItem({ title = "Acceptance Item", infoHash, link, guid }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa">
  <channel>
    <title>Nyaa</title>
    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${guid}</guid>
      <nyaa:seeders>3</nyaa:seeders>
      <nyaa:leechers>1</nyaa:leechers>
      <nyaa:infoHash>${infoHash}</nyaa:infoHash>
      <nyaa:category>Literature - English-translated</nyaa:category>
      <nyaa:size>12 MiB</nyaa:size>
    </item>
  </channel>
</rss>`;
}

const providerModule = await import(pathToFileURL(path.join(root, "main.js")).href);
const provider = providerModule.default;

async function runScenario({ rss, detailHtml, chapterNumber = "12" }) {
  const requests = [];
  const diagnostics = [];
  globalThis.tsuzuki = {
    http: {
      async request(method, url) {
        assert.equal(method, "GET");
        requests.push(url);
        const parsed = new NativeURL(url);
        if (parsed.pathname === "/" && parsed.searchParams.get("page") === "rss") {
          return JSON.stringify({ statusCode: 200, body: rss });
        }
        if (parsed.pathname.startsWith("/view/")) {
          return JSON.stringify({ statusCode: 200, body: detailHtml ?? singleFixture });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    },
    log: {
      async info(message) {
        diagnostics.push(JSON.parse(message));
      },
    },
  };

  const result = await provider.torrent.search({
    titles: ["Acceptance Title"],
    preferredLanguages: ["en"],
    chapterNumber,
    volume: 1,
    cursor: null,
  });
  return { result, requests, diagnostics };
}

{
  const { result, diagnostics } = await runScenario({ rss: emptyRss });
  assert.equal(result.items.length, 0);
  assert.deepEqual(
    diagnostics.map(({ rawItemCount, acceptedCandidateCount }) => ({ rawItemCount, acceptedCandidateCount })),
    [
      { rawItemCount: 0, acceptedCandidateCount: 0 },
      { rawItemCount: 0, acceptedCandidateCount: 0 },
    ],
  );
}

const validHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const validMagnetRss = rssItem({
  infoHash: validHash,
  link: `magnet:?xt=urn:btih:${validHash}`,
  guid: "https://nyaa.si/view/1111111",
});

{
  const { result, diagnostics } = await runScenario({ rss: validMagnetRss });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].infoHash, validHash);
  assert.deepEqual(
    diagnostics.map(({ rawItemCount, acceptedCandidateCount }) => ({ rawItemCount, acceptedCandidateCount })),
    [{ rawItemCount: 1, acceptedCandidateCount: 1 }],
  );
}

{
  const previousUrl = globalThis.URL;
  globalThis.URL = undefined;
  try {
    const { result, diagnostics } = await runScenario({ rss: validMagnetRss });
    assert.equal(
      result.items.length,
      1,
      "Nyaa Provider must accept valid RSS without relying on a browser URL global that QuickJS does not guarantee",
    );
    assert.deepEqual(
      diagnostics.map(({ rawItemCount, acceptedCandidateCount }) => ({ rawItemCount, acceptedCandidateCount })),
      [{ rawItemCount: 1, acceptedCandidateCount: 1 }],
    );
  } finally {
    globalThis.URL = previousUrl;
  }
}

{
  const mismatched = rssItem({
    infoHash: validHash,
    link: "magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    guid: "https://nyaa.si/view/2222222",
  });
  const { result, diagnostics } = await runScenario({ rss: mismatched });
  assert.equal(result.items.length, 0);
  assert.ok(diagnostics.every((entry) => entry.rawItemCount === 1));
  assert.ok(diagnostics.every((entry) => entry.acceptedCandidateCount === 0));
}

{
  const invalidGuid = rssItem({
    infoHash: validHash,
    link: `magnet:?xt=urn:btih:${validHash}`,
    guid: "https://example.invalid/view/3333333",
  });
  const { result, diagnostics } = await runScenario({ rss: invalidGuid });
  assert.equal(result.items.length, 0);
  assert.ok(diagnostics.every((entry) => entry.rawItemCount === 1));
  assert.ok(diagnostics.every((entry) => entry.acceptedCandidateCount === 0));
}

{
  const { result } = await runScenario({ rss: validMagnetRss, detailHtml: singleFixture });
  assert.deepEqual(result.items[0].files, [
    {
      index: 0,
      path: "Public Domain Test Chapter 1.cbz",
      sizeBytes: 12 * 1024 * 1024,
      languages: ["en"],
    },
  ]);
}

{
  const { result } = await runScenario({ rss: validMagnetRss, detailHtml: multiFixture });
  assert.equal(
    result.items[0].files,
    undefined,
    "multi-file detail pages must remain unmapped until Host torrent metadata provides exact indices",
  );
}

console.log("Nyaa Provider item acceptance matrix: OK");
