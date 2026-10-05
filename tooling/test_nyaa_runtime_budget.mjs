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
      requests.push(parsed.searchParams.get("q"));
      fakeNow += 900;
      return JSON.stringify({ statusCode: 200, body: emptySearchFixture });
    },
  },
};

try {
  const providerModule = await import(pathToFileURL(path.join(root, "main.js")).href);
  const provider = providerModule.default;

  const result = await provider.torrent.search({
    titles: ["Primary", "Alias One", "Alias Two", "Alias Three", "Alias Four"],
    preferredLanguages: ["en"],
    chapterNumber: "12",
    volume: 1,
    cursor: null,
  });

  assert.deepEqual(result, { items: [], nextCursor: null });
  assert.deepEqual(
    requests,
    ["Primary 12", "Primary", "Alias One 12"],
    "slow discovery must stop before exhausting the Host runtime budget or walking every stored alias",
  );
} finally {
  Date.now = originalDateNow;
}

console.log("Nyaa Provider runtime discovery budget fixture: OK");
