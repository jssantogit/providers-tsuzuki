import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("providers/nyaa");
const emptySearchFixture = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa"><channel><title>Nyaa</title></channel></rss>\n`;
const requests = [];
let fakeNow = 0;
const originalDateNow = Date.now;

Date.now = () => fakeNow;

globalThis.tsuzuki = {
  http: {
    async request(method, url) {
      assert.equal(method, "GET");
      const parsed = new URL(url);
      assert.equal(parsed.origin, "https://nyaa.si");
      assert.equal(parsed.searchParams.get("page"), "rss");
      const query = parsed.searchParams.get("q");
      requests.push(query);

      if (query === "Primary 12") {
        fakeNow += 3000;
      }

      return JSON.stringify({ statusCode: 200, body: emptySearchFixture });
    },
  },
};

try {
  const providerModule = await import(pathToFileURL(path.join(root, "main.js")).href);
  const provider = providerModule.default;

  const result = await provider.torrent.search({
    titles: ["Primary", "Alias One", "Alias Two"],
    preferredLanguages: ["en"],
    chapterNumber: "12",
    volume: 1,
    cursor: null,
  });

  assert.deepEqual(result, { items: [], nextCursor: null });
  assert.deepEqual(
    requests,
    ["Primary 12", "Primary"],
    "a slow empty narrow search must not suppress the primary title-only fallback, and aliases must remain budget-bounded",
  );
} finally {
  Date.now = originalDateNow;
}

console.log("Nyaa Provider slow primary fallback fixture: OK");
