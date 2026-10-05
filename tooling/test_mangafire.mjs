import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { signCanonicalPath } from "../providers/mangafire/modules/vrf.js";

const root = path.resolve("providers/mangafire");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures", name), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const searchFixture = fixture("search.json");
const chaptersFixture = fixture("chapters.json");
const pagesFixture = fixture("pages.json");
const requests = [];

function originAllowed(url, allowedOrigins) {
  const parsed = new URL(url);
  return allowedOrigins.some((origin) => {
    const allowed = new URL(origin.replace("*.", "wildcard."));
    if (parsed.protocol !== allowed.protocol) return false;
    if (!origin.includes("*.")) return parsed.hostname === allowed.hostname;
    const suffix = allowed.hostname.slice("wildcard".length);
    return parsed.hostname.endsWith(suffix) && parsed.hostname.length > suffix.length;
  });
}

assert.equal(
  signCanonicalPath("/titles?keyword=One Piece&limit=5&page=1"),
  "8sK3xtqdFZfetBhus6bRAgjs3ThN8AAWnXHwyfoOUBfrClGierSKzA",
  "VRF transform changed unexpectedly",
);

globalThis.tsuzuki = {
  http: {
    async request(method, url, headersJson) {
      requests.push({ method, url, headersJson });
      const parsed = new URL(url);
      assert.equal(method, "GET");
      assert.ok(parsed.searchParams.get("vrf"), "every MangaFire API call must be signed");
      if (parsed.pathname === "/api/titles") {
        return JSON.stringify({ statusCode: 200, body: JSON.stringify(searchFixture) });
      }
      if (parsed.pathname === "/api/titles/one-piece-test/chapters") {
        return JSON.stringify({ statusCode: 200, body: JSON.stringify(chaptersFixture) });
      }
      if (parsed.pathname === "/api/chapters/101") {
        return JSON.stringify({ statusCode: 200, body: JSON.stringify(pagesFixture) });
      }
      throw new Error(`Unexpected MangaFire fixture request: ${parsed.pathname}`);
    },
  },
  browser: {
    async readText() {
      throw new Error("Browser fallback should not be used in the happy-path fixture");
    },
  },
};

const providerModule = await import(pathToFileURL(path.join(root, "main.js")).href);
const provider = providerModule.default;

for (const capability of ["lookup", "chapters", "pages"]) {
  assert.equal(typeof provider?.reading?.[capability], "function", `missing reading.${capability}`);
}

const lookup = await provider.reading.lookup({ titles: ["One Piece"] });
assert.deepEqual(lookup, {
  items: [
    {
      externalWorkId: "one-piece-test",
      title: "One Piece",
      aliases: [],
      url: "https://mangafire.to/title/one-piece-test-one-piece",
      language: "en",
    },
  ],
  nextCursor: null,
});

const chapters = await provider.reading.chapters({
  binding: {
    providerId: "app.tsuzuki.mangafire",
    facetId: "en",
    externalWorkId: "one-piece-test",
  },
  cursor: null,
});
assert.equal(chapters.items.length, 1);
assert.equal(chapters.items[0].providerChapterId, "101");
assert.equal(chapters.items[0].rawNumber, 1);
assert.equal(chapters.items[0].language, "en");
assert.equal(chapters.nextCursor, null);

const pages = await provider.reading.pages({
  binding: {
    providerId: "app.tsuzuki.mangafire",
    facetId: "en",
    externalWorkId: "one-piece-test",
  },
  providerChapterId: "101",
});
assert.equal(pages.type, "page_list");
assert.equal(pages.pages.length, 2);
assert.deepEqual(pages.pages[0].headers, { Referer: "https://mangafire.to" });
const allowedPageOrigins = manifest.permissions.network.origins;
for (const page of pages.pages) {
  assert.equal(
    originAllowed(page.url, allowedPageOrigins),
    true,
    `page host must be covered by Provider network authority: ${new URL(page.url).hostname}`,
  );
}
assert.equal(requests.length, 3);

let browserUsed = false;
globalThis.tsuzuki.http.request = async () => JSON.stringify({
  statusCode: 403,
  body: JSON.stringify({ error: "captcha_required", challenge: "/@waf/challenge" }),
});
globalThis.tsuzuki.browser.readText = async (_url, selector) => {
  browserUsed = true;
  assert.equal(selector, "body");
  return JSON.stringify(searchFixture);
};
const browserLookup = await provider.reading.lookup({ titles: ["One Piece"] });
assert.equal(browserUsed, true);
assert.equal(browserLookup.items[0].externalWorkId, "one-piece-test");

console.log("MangaFire Provider conformance fixtures: OK");
