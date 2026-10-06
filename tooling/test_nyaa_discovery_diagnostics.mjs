import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("providers/nyaa");
const logs = [];
let fakeNow = 1000;
const originalDateNow = Date.now;

const rssFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa">
  <channel>
    <title>Nyaa</title>
    <item>
      <title>Diagnostic Test Chapter 7</title>
      <link>magnet:?xt=urn:btih:1111111111111111111111111111111111111111</link>
      <guid isPermaLink="true">https://nyaa.si/view/1111111</guid>
      <nyaa:infoHash>1111111111111111111111111111111111111111</nyaa:infoHash>
      <nyaa:category>Literature - English-translated</nyaa:category>
      <nyaa:size>10 MiB</nyaa:size>
      <nyaa:seeders>3</nyaa:seeders>
      <nyaa:leechers>1</nyaa:leechers>
    </item>
    <item>
      <title>Rejected raw item</title>
      <link>https://example.invalid/not-nyaa</link>
      <guid isPermaLink="true">https://nyaa.si/view/2222222</guid>
      <nyaa:infoHash>2222222222222222222222222222222222222222</nyaa:infoHash>
    </item>
  </channel>
</rss>`;

Date.now = () => fakeNow;

globalThis.tsuzuki = {
  http: {
    async request(method, url) {
      assert.equal(method, "GET");
      const parsed = new URL(url);
      if (parsed.searchParams.get("page") === "rss") {
        fakeNow += 120;
        return JSON.stringify({ statusCode: 200, body: rssFixture });
      }
      if (parsed.pathname === "/view/1111111") {
        return JSON.stringify({ statusCode: 200, body: "<html><body></body></html>" });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  },
  log: {
    async info(message) {
      logs.push(message);
    },
  },
};

try {
  const providerModule = await import(pathToFileURL(path.join(root, "main.js")).href);
  const provider = providerModule.default;

  const result = await provider.torrent.search({
    titles: ["Diagnostic Test"],
    preferredLanguages: ["en"],
    chapterNumber: "7",
    volume: 1,
    cursor: null,
  });

  assert.equal(result.items.length, 1);
  assert.deepEqual(logs, [
    "TSZ_DISCOVERY_V1 state=start attempt=1 phase=primary_narrow",
    "TSZ_DISCOVERY_V1 state=end attempt=1 phase=primary_narrow raw=2 accepted=1 duration_ms=120",
  ]);
  assert.equal(logs.some((line) => line.includes("Diagnostic Test")), false, "diagnostics must not leak titles");
  assert.equal(logs.some((line) => line.includes("nyaa.si")), false, "diagnostics must not leak URLs");
} finally {
  Date.now = originalDateNow;
}

console.log("Nyaa Provider discovery diagnostics fixture: OK");
