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
        // Timeout-safe pagination must fetch early canonical chapters first.
        assert.equal(parsed.searchParams.get("sort"), "number");
        assert.equal(parsed.searchParams.get("order"), "asc");
        assert.equal(parsed.searchParams.get("page"), "1");
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

 // Provider chapter IDs are opaque and must not be trusted as the identity of a
 // different upstream payload. Reject an explicitly contradictory chapter
 // identity/language/work instead of handing its pages to the Reader.
 const requestedPagesBinding = {
   providerId: "app.tsuzuki.mangafire",
   facetId: "en",
   externalWorkId: "one-piece-test",
 };
 for (const wrongData of [
   { id: 999, number: 1, language: "en", pages: [{ url: "https://s.mfcdn.cc/assets/foreign.jpg" }] },
   { id: 101, number: 1, language: "es", pages: [{ url: "https://s.mfcdn.cc/assets/spanish.jpg" }] },
   { id: 101, number: 1, language: "en", manga: { hid: "foreign-work" }, pages: [{ url: "https://s.mfcdn.cc/assets/foreign.jpg" }] },
 ]) {
   globalThis.tsuzuki.http.request = async () => JSON.stringify({
     statusCode: 200,
     body: JSON.stringify({ data: wrongData }),
   });
   await assert.rejects(
     provider.reading.pages({ binding: requestedPagesBinding, providerChapterId: "101" }),
     /mismatch|identity|language|work/i,
     "Contradictory upstream chapter metadata must never reach the Reader",
   );
 }
 // A numeric database parent ID cannot be equated to a public work HID.
 // Rejecting it would break valid MangaFire pages if the site exposes both
 // identifiers in different namespaces.
 globalThis.tsuzuki.http.request = async () => JSON.stringify({
   statusCode: 200,
   body: JSON.stringify({
     data: { id: 101, mangaId: 42, language: "en", pages: pagesFixture.data.pages },
   }),
 });
 assert.equal(
   (await provider.reading.pages({ binding: requestedPagesBinding, providerChapterId: "101" })).pages.length,
   2,
 );

 // A chapter response with no optional identity fields remains supported.
 globalThis.tsuzuki.http.request = async () => JSON.stringify({
   statusCode: 200,
   body: JSON.stringify(pagesFixture),
 });
 assert.equal(
   (await provider.reading.pages({ binding: requestedPagesBinding, providerChapterId: "101" })).pages.length,
   2,
 );

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

// A differently spelled search hit must not be silently discarded when MangaFire's
// own detail endpoint attests an exact alternative title.
let detailCalls = 0;
globalThis.tsuzuki.http.request = async (_method, url) => {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/titles") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({
        items: [{ hid: "haikyuu-work", slug: "haikyu", title: "Haikyu!!" }],
      }),
    });
  }
  if (pathname === "/api/titles/haikyuu-work") {
    detailCalls++;
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({
        data: { title: "Haikyu!!", alternativeTitles: ["Haikyuu!!", "ハイキュー!!"] },
      }),
    });
  }
  throw new Error("Unexpected detail lookup request");
};
const aliasLookup = await provider.reading.lookup({ titles: ["Haikyuu!!"] });
assert.equal(aliasLookup.items.length, 1);
assert.deepEqual(aliasLookup.items[0].aliases, ["Haikyuu!!", "ハイキュー!!"]);
assert.equal(detailCalls, 1);

// Whitespace variation in the provider's own title must not discard a
// genuinely attested alias. This is not fuzzy title matching.
globalThis.tsuzuki.http.request = async (_method, url) => {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/titles") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({ items: [{ hid: "haikyuu-work", title: "Haikyu   !!" }] }),
    });
  }
  if (pathname === "/api/titles/haikyuu-work") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({
        data: { title: "Haikyu !!", alternativeTitles: ["Haikyuu!!"] },
      }),
    });
  }
  throw new Error("Unexpected normalized-title fixture request");
};
const whitespaceAliasLookup = await provider.reading.lookup({ titles: ["Haikyuu!!"] });
assert.deepEqual(whitespaceAliasLookup.items[0].aliases, ["Haikyuu!!"]);

// A stale/foreign detail response may never authorize an alias binding.
globalThis.tsuzuki.http.request = async (_method, url) => {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/titles") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({
        items: [{ hid: "haikyuu-work", slug: "haikyu", title: "Haikyu!!" }],
      }),
    });
  }
  if (pathname === "/api/titles/haikyuu-work") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({
        data: { title: "Different Work", alternativeTitles: ["Haikyuu!!"] },
      }),
    });
  }
  throw new Error("Unexpected lookup fixture request");
};
const mismatchedDetailLookup = await provider.reading.lookup({ titles: ["Haikyuu!!"] });
assert.equal(mismatchedDetailLookup.items.length, 1);
assert.deepEqual(mismatchedDetailLookup.items[0].aliases, []);

// An explicitly foreign HID in a detail response must never attach aliases
// to a lookalike title returned in the search result.
globalThis.tsuzuki.http.request = async (_method, url) => {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/titles") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({ items: [{ hid: "real-work", title: "Haikyu!!" }] }),
    });
  }
  if (pathname === "/api/titles/real-work") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({
        data: { hid: "foreign-work", title: "Haikyu!!", alternativeTitles: ["Haikyuu!!"] },
      }),
    });
  }
  throw new Error("Unexpected mismatched HID fixture path");
};
const foreignHidLookup = await provider.reading.lookup({ titles: ["Haikyuu!!"] });
assert.deepEqual(foreignHidLookup.items[0].aliases, []);

// An HTTP 200 containing a human-facing challenge is not a successful JSON page.
let challenged200Fallbacks = 0;
globalThis.tsuzuki.http.request = async () => JSON.stringify({
  statusCode: 200,
  body: "<!doctype html><html><title>Just a moment</title></html>",
});
globalThis.tsuzuki.browser.readText = async (_url, selector) => {
  assert.equal(selector, "body");
  challenged200Fallbacks++;
  return JSON.stringify(searchFixture);
};
const htmlChallengeLookup = await provider.reading.lookup({ titles: ["One Piece"] });
assert.equal(htmlChallengeLookup.items[0].externalWorkId, "one-piece-test");
assert.equal(challenged200Fallbacks, 1);

// A genuine malformed JSON body must fail instead of masquerading as empty chapters.
globalThis.tsuzuki.http.request = async () => JSON.stringify({
  statusCode: 200,
  body: "{not valid json",
});
await assert.rejects(
  provider.reading.lookup({ titles: ["One Piece"] }),
  /JSON|Unexpected token|Expected property/i,
);

// Missing item arrays are malformed successful HTTP payloads, not empty results.
globalThis.tsuzuki.http.request = async () => JSON.stringify({
  statusCode: 200,
  body: JSON.stringify({ data: { captcha: true }, meta: { lastPage: 1 } }),
});
await assert.rejects(
  provider.reading.lookup({ titles: ["One Piece"] }),
  /invalid.*items|missing.*items|malformed.*items/i,
);
await assert.rejects(
  provider.reading.chapters({
    binding: { externalWorkId: "one-piece-test", facetId: "en" },
    cursor: null,
  }),
  /invalid.*items|missing.*items|malformed.*items/i,
);

// Real empty inventories must remain distinguishable from schema failures.
globalThis.tsuzuki.http.request = async () => JSON.stringify({
  statusCode: 200,
  body: JSON.stringify({ items: [], meta: { lastPage: 1, hasNext: false } }),
});
const genuineEmpty = await provider.reading.chapters({
  binding: { externalWorkId: "one-piece-test", facetId: "en" },
  cursor: null,
});
assert.deepEqual(genuineEmpty, { items: [], nextCursor: null });


// A manually supplied MangaFire title URL must resolve to exactly that source-attested
// work, even when its displayed title differs from the Tsuzuki canonical title.
// This also distinguishes standard and colored editions sharing a title.
const directTitles = [
  ["7j6", "demon-slayer-kimetsu-no-yaiba", "Demon Slayer: Kimetsu no Yaiba", "Kimetsu no Yaiba"],
  ["gry", "the-seven-deadly-sins", "The Seven Deadly Sins", "Nanatsu no Taizai"],
  ["kkvk9", "boku-no-hero-academia", "Boku no Hero Academia", "My Hero Academia"],
  ["np3ln", "boku-no-hero-academiaa", "Boku no Hero Academia (Colored)", "My Hero Academia"],
];
let directDetailCalls = 0;
globalThis.tsuzuki.http.request = async (_method, url) => {
  const pathname = new URL(url).pathname;
  const record = directTitles.find(([id]) => pathname === `/api/titles/${id}`);
  assert.ok(record, `Direct title lookup must fetch a detail, not search: ${pathname}`);
  directDetailCalls++;
  const [hid, slug, title, alias] = record;
  return JSON.stringify({
    statusCode: 200,
    body: JSON.stringify({ data: { hid, slug, title, alternativeTitles: [alias] } }),
  });
};
for (const [hid, slug, title, alias] of directTitles) {
  const found = await provider.reading.lookup({
    titles: [`https://mangafire.to/title/${hid}-${slug}`],
  });
  assert.equal(found.items.length, 1);
  assert.deepEqual(found.items[0], {
    externalWorkId: hid,
    title,
    aliases: [alias],
    url: `https://mangafire.to/title/${hid}-${slug}`,
    language: "en",
  });
}
assert.equal(directDetailCalls, directTitles.length);
await assert.rejects(
  provider.reading.lookup({ titles: ["https://mangafire.to.evil.example/title/gry-the-seven-deadly-sins"] }),
  /MangaFire URL/i,
);
globalThis.tsuzuki.http.request = async () => JSON.stringify({
  statusCode: 200,
  body: JSON.stringify({ data: { hid: "wrong-id", title: "The Seven Deadly Sins" } }),
});
await assert.rejects(
  provider.reading.lookup({ titles: ["https://mangafire.to/title/gry-the-seven-deadly-sins"] }),
  /MangaFire (URL|identity)/i,
);


// Some API variants return chapter items but no pagination metadata. Those
// results are not proof of completeness: probe the next page until an empty
// terminal response rather than prematurely detaching older chapter support.
let metadataFreePage = 0;
globalThis.tsuzuki.http.request = async (_method, url) => {
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/api/titles/gry/chapters");
  assert.ok(parsed.searchParams.get("vrf"));
  metadataFreePage = Number(parsed.searchParams.get("page"));
  return JSON.stringify({
    statusCode: 200,
    body: JSON.stringify(metadataFreePage === 1
      ? { items: [{ id: 101, number: 1, name: "First" }] }
      : { items: [] }),
  });
};
const incompleteMeta = await provider.reading.chapters({
  binding: { externalWorkId: "gry", facetId: "en" },
  cursor: null,
});
assert.equal(incompleteMeta.nextCursor, "2", "A page without metadata is not a complete inventory");
const emptyTerminal = await provider.reading.chapters({
  binding: { externalWorkId: "gry", facetId: "en" },
  cursor: incompleteMeta.nextCursor,
});
assert.deepEqual(emptyTerminal, { items: [], nextCursor: null });
assert.equal(metadataFreePage, 2);

// MangaFire supplies per-chapter language. Do not silently mark Spanish chapters
// as English or prefer a foreign-language official variant over the en entry.
globalThis.tsuzuki.http.request = async (_method, url) => {
  assert.equal(new URL(url).pathname, "/api/titles/gry/chapters");
  return JSON.stringify({
    statusCode: 200,
    body: JSON.stringify({
      items: [
        { id: 201, number: 1, language: "es", type: "official", name: "Spanish" },
        { id: 202, number: 1, language: "en", type: "fan", name: "English" },
        { id: 203, number: 2, language: "en", type: "official", name: "Next chapter" },
      ],
      meta: { hasNext: false, lastPage: 1 },
    }),
  });
};
const englishFacet = await provider.reading.chapters({
  binding: { externalWorkId: "gry", facetId: "en" },
  cursor: null,
});
assert.deepEqual(englishFacet.items.map((item) => item.providerChapterId), ["202", "203"]);
assert.ok(englishFacet.items.every((item) => item.language === "en"));

// When several primary HIDs already match the same title, optional detail
// enrichment on unrelated works cannot break the tie and wastes the Host's
// 20-second inventory deadline. Do not fetch unrelated details in this case.
let ambiguousDetailRequests = 0;
globalThis.tsuzuki.http.request = async (_method, url) => {
  const parsed = new URL(url);
  if (parsed.pathname === "/api/titles") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({
        items: [
          { hid: "qnlvj", slug: "vagabond22", title: "Vagabond", aliases: ["Vagabond (Official Colored)"], chapterCount: 327 },
          { hid: "4mx", slug: "vagabondd", title: "Vagabond" },
          { hid: "unrelated-1", title: "Vagabond: Son of Darkness" },
          { hid: "unrelated-2", title: "A Different Work" },
        ],
      }),
    });
  }
  ambiguousDetailRequests++;
  throw new Error("Ambiguous lookup must not request unrelated detail metadata");
};
const realVagabondLookup = await provider.reading.lookup({ titles: ["Vagabond"], diagnosticsVersion: 1 });
assert.deepEqual(realVagabondLookup.items.slice(0, 2).map((item) => item.externalWorkId), ["qnlvj", "4mx"]);
assert.equal(ambiguousDetailRequests, 0);
assert.equal(realVagabondLookup.items.length, 4);
assert.equal(realVagabondLookup.items[0].chapterCount, 327, "record source-reported count only");
assert.equal("chapterCount" in realVagabondLookup.items[1], false, "unknown is not zero");
const legacyCount = await provider.reading.lookup({ titles: ["Vagabond"] });
assert.equal("chapterCount" in legacyCount.items[0], false,
  "strict legacy clients must not receive new chapterCount metadata");
assert.equal("detailOutcome" in legacyCount.items[0], false,
  "strict legacy clients must not receive detail diagnostics");
assert.deepEqual(Object.keys(legacyCount.items[0]).sort(),
  ["externalWorkId", "title", "aliases", "url", "language"].sort(),
  "legacy candidate wire shape must be identical even when source has additional metadata");
const unknownDiagnosticsVersion = await provider.reading.lookup({
  titles: ["Vagabond"], diagnosticsVersion: 3,
});
assert.deepEqual(Object.keys(unknownDiagnosticsVersion.items[0]).sort(),
  ["externalWorkId", "title", "aliases", "url", "language"].sort(),
  "future versions must not accidentally expose unnegotiated response keys");

// Physical #176 smoke: v7 reported qnlvj and 4mx as identical "Vagabond"
// entries with NO alternative titles. Their details must be queried (bounded)
// to recover any source-attested edition qualifier; unrelated results must NOT
// burn the budget. Never choose the first HID without corroboration.
const ambiguousExactDetails = [];
globalThis.tsuzuki.http.request = async (_method, url) => {
  const parsed = new URL(url);
  if (parsed.pathname === "/api/titles") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({
        items: [
          { hid: "qnlvj", title: "Vagabond", slug: "vagabond22" },
          { hid: "4mx", title: "Vagabond", slug: "vagabondd" },
          { hid: "unrelated", title: "Vagabond: unrelated title" },
        ],
      }),
    });
  }
  ambiguousExactDetails.push(parsed.pathname);
  if (parsed.pathname === "/api/titles/qnlvj") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({
        data: { hid: "qnlvj", title: "Vagabond", alternativeTitles: ["Vagabond (Official Colored)"] },
      }),
    });
  }
  if (parsed.pathname === "/api/titles/4mx") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({ data: { hid: "4mx", title: "Vagabond", alternativeTitles: [] } }),
    });
  }
  throw new Error("Details of irrelevant search results must not run");
};
const qualifiedVagabond = await provider.reading.lookup({ titles: ["Vagabond"], diagnosticsVersion: 1 });
assert.deepEqual(ambiguousExactDetails, ["/api/titles/qnlvj", "/api/titles/4mx"]);
assert.deepEqual(qualifiedVagabond.items[0].aliases, ["Vagabond (Official Colored)"]);
assert.equal(qualifiedVagabond.items[0].detailOutcome, "VERIFIED_WITH_ALIASES");
assert.equal(qualifiedVagabond.items[1].detailOutcome, "VERIFIED_NO_ALIASES");
assert.deepEqual(qualifiedVagabond.items[1].aliases, []);
assert.equal(qualifiedVagabond.items.length, 3);
const legacyVagabond = await provider.reading.lookup({ titles: ["Vagabond"] });
assert.deepEqual(legacyVagabond.items[0].aliases, ["Vagabond (Official Colored)"]);
assert.equal("detailOutcome" in legacyVagabond.items[0], false, "old Host must not receive unknown response keys");
assert.equal("detailHttpStatus" in legacyVagabond.items[0], false);

// A source that reports many homonymous HIDs must not cause an unbounded
// detail fan-out or gain an arbitrary selected ID by search position.
let homonymDetails = 0;
globalThis.tsuzuki.http.request = async (_method, url) => {
  const parsed = new URL(url);
  if (parsed.pathname === "/api/titles") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({
        items: Array.from({ length: 9 }, (_, i) => ({ hid: `id-${i}`, title: "Duplicated" })),
      }),
    });
  }
  homonymDetails++;
  return JSON.stringify({
    statusCode: 200,
    body: JSON.stringify({
      data: { hid: parsed.pathname.split("/").at(-1), title: "Duplicated", alternativeTitles: [] },
    }),
  });
};
const homonyms = await provider.reading.lookup({ titles: ["Duplicated"], diagnosticsVersion: 1 });
assert.equal(homonymDetails, 5, "limit identity detail calls to the fixed provider budget");
assert.equal(homonyms.items.length, 9);
assert.equal(homonyms.items[5].detailOutcome, "BUDGET_EXHAUSTED");
assert.ok(homonyms.items.every((item) => item.aliases.length === 0));

// Detail responses which identify an unrelated HID cannot qualify the edition
// even if their titles match a duplicated primary search result.
globalThis.tsuzuki.http.request = async (_method, url) => {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/titles") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({ items: [
        { hid: "actual", title: "Duplicated" },
        { hid: "other", title: "Duplicated" },
      ] }),
    });
  }
  return JSON.stringify({
    statusCode: 200,
    body: JSON.stringify({
      data: { hid: pathname === "/api/titles/actual" ? "wrong" : "other",
        title: "Duplicated", alternativeTitles: ["Duplicated (Colored)"] },
    }),
  });
};
const conflictingDetails = await provider.reading.lookup({ titles: ["Duplicated"], diagnosticsVersion: 1 });
assert.deepEqual(conflictingDetails.items[0].aliases, []);
assert.deepEqual(conflictingDetails.items[1].aliases, ["Duplicated (Colored)"]);

// Detail failure must be classified without ever returning upstream error text.
// The Host logs only a closed code and a bounded HTTP response status.
globalThis.tsuzuki.http.request = async (_method, url) => {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/titles") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({ items: [
        { hid: "real-a", title: "Vagabond" },
        { hid: "real-b", title: "Vagabond" },
      ] }),
    });
  }
  if (pathname === "/api/titles/real-a") {
    return JSON.stringify({ statusCode: 503, body: "temporary outage" });
  }
  return JSON.stringify({
    statusCode: 200,
    body: JSON.stringify({ data: { hid: "real-b", title: "Vagabond" } }),
  });
};
const degradedDetail = await provider.reading.lookup({ titles: ["Vagabond"], diagnosticsVersion: 1 });
assert.equal(degradedDetail.items[0].detailOutcome, "DETAIL_FAILED");
assert.equal(degradedDetail.items[0].detailHttpStatus, 503);
assert.equal(degradedDetail.items[1].detailOutcome, "VERIFIED_NO_ALIASES");
assert.equal("detailHttpStatus" in degradedDetail.items[1], false);

// A protected challenge is a distinct operational cause from a metadata
// mismatch or a quiet missing alternate edition; do not log body contents.
globalThis.tsuzuki.http.request = async (_method, url) => {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/titles") {
    return JSON.stringify({ statusCode: 200, body: JSON.stringify({ items: [
      { hid: "real-a", title: "Vagabond" },
      { hid: "real-b", title: "Vagabond" },
    ] }) });
  }
  if (pathname === "/api/titles/real-a") {
    return JSON.stringify({ statusCode: 403, body: "challenge" });
  }
  return JSON.stringify({
    statusCode: 200,
    body: JSON.stringify({ data: { hid: "real-b", title: "Vagabond" } }),
  });
};
globalThis.tsuzuki.browser.readText = async () => { throw new Error("Challenge requires user interaction"); };
const blockedDetail = await provider.reading.lookup({ titles: ["Vagabond"], diagnosticsVersion: 1 });
assert.equal(blockedDetail.items[0].detailOutcome, "CHALLENGE_BLOCKED");
assert.equal(blockedDetail.items[0].detailHttpStatus, 403);

// HTTP 200 containing an interactive HTML challenge is not a successful
// detail lookup. If the Browser Host cannot resolve it, report CHALLENGE_BLOCKED
// rather than a generic network failure or an empty edition.
globalThis.tsuzuki.http.request = async (_method, url) => {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/titles") {
    return JSON.stringify({ statusCode: 200, body: JSON.stringify({ items: [
      { hid: "real-a", title: "Vagabond" },
      { hid: "real-b", title: "Vagabond" },
    ] }) });
  }
  if (pathname === "/api/titles/real-a") {
    return JSON.stringify({ statusCode: 200, body: "<!doctype html><html>Just a moment</html>" });
  }
  return JSON.stringify({
    statusCode: 200,
    body: JSON.stringify({ data: { hid: "real-b", title: "Vagabond" } }),
  });
};
globalThis.tsuzuki.browser.readText = async () => { throw new Error("Browser navigation blocked"); };
const htmlBlocked = await provider.reading.lookup({ titles: ["Vagabond"], diagnosticsVersion: 1 });
assert.equal(htmlBlocked.items[0].detailOutcome, "CHALLENGE_BLOCKED");
assert.equal(htmlBlocked.items[0].detailHttpStatus, 200, "record challenge HTTP 200, not generic missing status");

// A challenge disguised as HTTP 200 at the search endpoint must also
// preserve that HTTP status, not become a generic source error.
globalThis.tsuzuki.http.request = async () => JSON.stringify({
  statusCode: 200,
  body: "<!doctype html><html>Just a moment</html>",
});
globalThis.tsuzuki.browser.readText = async () => { throw new Error("Unavailable challenge"); };
const htmlSearchBlocked = await provider.reading.lookup({ titles: ["Vagabond"], diagnosticsVersion: 1 });
assert.deepEqual(htmlSearchBlocked, {
  items: [], nextCursor: null, lookupFailureCode: "CHALLENGE_BLOCKED", lookupHttpStatus: 200,
});

// A source lookup failure occurs before any candidate can report detailOutcome.
// New Hosts request closed error provenance; older Hosts still receive errors.
// Never return an apparently successful empty inventory after an upstream 403.
globalThis.tsuzuki.http.request = async () => JSON.stringify({
  statusCode: 403,
  body: JSON.stringify({ challenge: true }),
});
globalThis.tsuzuki.browser.readText = async () => {
  throw new Error("Interactive MangaFire challenge not available");
};
const challengedSearch = await provider.reading.lookup({
  titles: ["Vagabond"],
  diagnosticsVersion: 1,
});
assert.deepEqual(challengedSearch, {
  items: [],
  nextCursor: null,
  lookupFailureCode: "CHALLENGE_BLOCKED",
  lookupHttpStatus: 403,
});
await assert.rejects(
  provider.reading.lookup({ titles: ["Vagabond"] }),
  /challenge/i,
  "legacy Host must receive a real source error, not an empty inventory",
);
globalThis.tsuzuki.http.request = async () => JSON.stringify({
  statusCode: 503,
  body: "{}",
});
const unavailableSearch = await provider.reading.lookup({
  titles: ["Vagabond"],
  diagnosticsVersion: 1,
});
assert.deepEqual(unavailableSearch, {
  items: [],
  nextCursor: null,
  lookupFailureCode: "HTTP_ERROR",
  lookupHttpStatus: 503,
});
globalThis.tsuzuki.http.request = async () => JSON.stringify({
  statusCode: 200,
  body: JSON.stringify({ notItems: true }),
});
const malformedSearch = await provider.reading.lookup({
  titles: ["Vagabond"],
  diagnosticsVersion: 1,
});
assert.equal(malformedSearch.lookupFailureCode, "INVALID_RESPONSE");
assert.equal("lookupHttpStatus" in malformedSearch, false);
assert.deepEqual(malformedSearch.items, []);


// Issue #176 / physical code8: source search contains one primary Japanese hit,
// but the first ranked English hit has the Japanese alias only in its details.
// Do not sacrifice this alias, or a competing alias at rank 4/5. Keep the
// existing five-detail safety budget. The versioned Host can log an attested
// count from a verified detail, not a guessed count from the search ranking.
const physicalIssue176DetailCalls = [];
globalThis.tsuzuki.http.request = async (_method, url) => {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/titles") {
    return JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({ items: [
        { hid: "ln6lz", title: "Fullmetal Alchemist" },
        { hid: "7028y", title: "Hagane no Renkinjutsushi" },
        ...Array.from({ length: 18 }, (_, n) => ({
          hid: `unrelated-${n}`, title: `Unrelated ${n}`,
        })),
      ] }),
    });
  }
  physicalIssue176DetailCalls.push(pathname);
  const id = pathname.split("/").at(-1);
  return JSON.stringify({
    statusCode: 200,
    body: JSON.stringify({ data: {
      hid: id,
      title: id === "ln6lz" ? "Fullmetal Alchemist" :
        id === "7028y" ? "Hagane no Renkinjutsushi" : `Unrelated ${id.slice(-1)}`,
      alternativeTitles: id === "ln6lz" ? ["Hagane no Renkinjutsushi"] : [],
      chapterCount: id === "ln6lz" ? 116 : 0,
      authors: id === "ln6lz" ? [{ title: "Hiromu Arakawa" }] : [{ title: "Different Author" }],
    } }),
  });
};
const boundedJapaneseSearch = await provider.reading.lookup({
  titles: ["Hagane no Renkinjutsushi"],
  diagnosticsVersion: 1,
});
assert.ok(physicalIssue176DetailCalls.includes("/api/titles/ln6lz"),
  "ranked source aliases must remain discoverable");
assert.ok(physicalIssue176DetailCalls.length <= 5,
  "source detail enrichment must remain bounded at five requests");
assert.equal(boundedJapaneseSearch.items[0].aliases[0], "Hagane no Renkinjutsushi");
assert.equal(boundedJapaneseSearch.items[0].chapterCount, 116,
  "only the verified detail record may attest this chapter count");
assert.equal(boundedJapaneseSearch.items[5].detailOutcome, "SKIPPED_IRRELEVANT");
const legacyBoundedJapaneseSearch = await provider.reading.lookup({
  titles: ["Hagane no Renkinjutsushi"],
});
assert.equal("chapterCount" in legacyBoundedJapaneseSearch.items[0], false);
assert.equal("detailOutcome" in legacyBoundedJapaneseSearch.items[0], false);
const editorialJapaneseSearch = await provider.reading.lookup({
  titles: ["Hagane no Renkinjutsushi"], diagnosticsVersion: 2,
});
assert.deepEqual(editorialJapaneseSearch.items[0].authors, ["Hiromu Arakawa"],
  "only source-verified author names from a matching HID can corroborate editorial identity");
const requestedEditorialEvidence = await provider.reading.lookup({
  titles: ["Hagane no Renkinjutsushi"], diagnosticsVersion: 1, editorialEvidenceVersion: 1,
});
assert.deepEqual(requestedEditorialEvidence.items[0].authors, ["Hiromu Arakawa"],
  "V1 HTTP/status diagnostics remain present when the independent editorial protocol is opted into");
assert.deepEqual(requestedEditorialEvidence.items[1].authors, ["Different Author"],
  "the exact primary HID also requires verified details before authors may be trusted");
assert.equal("authors" in boundedJapaneseSearch.items[0], false,
  "diagnosticsVersion 1 must preserve the existing strict Host response contract");
assert.equal("authors" in legacyBoundedJapaneseSearch.items[0], false);


// An exact source title can coexist with a competing HID whose matching alias
// is exposed only in details at rank 4. Pruning after rank 3 would hide that
// ambiguity from the Host, which could then bind the wrong edition.
const hiddenEditionDetails = [];
globalThis.tsuzuki.http.request = async (_method, url) => {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/titles") {
    return JSON.stringify({ statusCode: 200, body: JSON.stringify({ items: [
      { hid: "main", title: "Vagabond" },
      { hid: "other-one", title: "Other One" },
      { hid: "other-two", title: "Other Two" },
      { hid: "hidden-edition", title: "Shin Vagabond" },
      { hid: "other-three", title: "Other Three" },
      { hid: "other-four", title: "Other Four" },
    ] }) });
  }
  hiddenEditionDetails.push(pathname);
  const id = pathname.split("/").at(-1);
  const titles = {
    "other-one": "Other One",
    "other-two": "Other Two",
    "hidden-edition": "Shin Vagabond",
    "other-three": "Other Three",
    "other-four": "Other Four",
  };
  return JSON.stringify({ statusCode: 200, body: JSON.stringify({ data: {
    hid: id, title: titles[id],
    alternativeTitles: id === "hidden-edition" ? ["Vagabond"] : [],
  } }) });
};
const lateAliasLookup = await provider.reading.lookup({
  titles: ["Vagabond"], diagnosticsVersion: 1,
});
assert.ok(hiddenEditionDetails.includes("/api/titles/hidden-edition"),
  "rank 4 editorial contender must not be silently discarded");
assert.ok(lateAliasLookup.items[3].aliases.includes("Vagabond"),
  "Host must see the second source-attested exact identity to reject automatic binding");


// #176: work identity and source coverage are separate facts. A same-author,
// same-title HID may have no English chapters, just 97, or additional pages.
// Probe only the exact contested HIDs when the upgraded Host explicitly asks.
const coverageCalls = [];
globalThis.tsuzuki.http.request = async (_method, url) => {
  const path = new URL(url).pathname;
  if (path === "/api/titles") {
    return JSON.stringify({ statusCode: 200, body: JSON.stringify({ items: [
      { hid: "kx1p6", title: "Chainsaw Man" },
      { hid: "kkyzv", title: "Chainsaw Man" },
      { hid: "0w5k", title: "Chainsaw Man" },
      { hid: "unrelated", title: "Chainsaw Person" },
    ] }) });
  }
  if (/^\/api\/titles\/[^/]+\/chapters$/.test(path)) {
    coverageCalls.push(path);
    const id = path.split("/")[3];
    const count = id === "0w5k" ? 101 : id === "kx1p6" ? 97 : 0;
    return JSON.stringify({ statusCode: 200, body: JSON.stringify({
      items: Array.from({ length: count }, (_, n) => ({ number: n + 1, id: String(5000 + n), language: "en" })),
      meta: { hasNext: id === "0w5k" },
    }) });
  }
  if (/^\/api\/titles\/[^/]+$/.test(path)) {
    const id = path.split("/").at(-1);
    return JSON.stringify({ statusCode: 200, body: JSON.stringify({
      data: { hid: id, title: "Chainsaw Man", authors: ["Fujimoto Tatsuki"] },
    }) });
  }
  throw new Error("Unexpected test URL");
};
const coverage = await provider.reading.lookup({
  titles: ["Chainsaw Man"], diagnosticsVersion: 1,
  editorialEvidenceVersion: 1, coverageEvidenceVersion: 1,
});
assert.deepEqual(coverage.items.slice(0, 3).map(item => item.coverageOutcome),
  ["OBSERVED", "EMPTY", "OBSERVED"]);
assert.deepEqual(coverage.items.slice(0, 3).map(item => item.coverageObservedCount),
  [97, 0, 101]);
assert.deepEqual(coverage.items.slice(0, 3).map(item => item.coverageHasMore),
  [false, false, true]);
assert.equal("coverageOutcome" in coverage.items[3], false);
assert.deepEqual(coverageCalls.sort(), [
  "/api/titles/0w5k/chapters", "/api/titles/kkyzv/chapters", "/api/titles/kx1p6/chapters",
].sort());
coverageCalls.length = 0;
const noProbe = await provider.reading.lookup({ titles: ["Chainsaw Man"], diagnosticsVersion: 1 });
assert.equal(coverageCalls.length, 0, "legacy lookup must never trigger extra network probes");
assert.equal("coverageOutcome" in noProbe.items[0], false);

console.log("MangaFire Provider conformance fixtures: OK");
