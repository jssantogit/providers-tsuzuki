import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const dir = path.resolve("providers/mangaall");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
assert.equal(manifest.id, "app.tsuzuki.mangaall");
assert.equal(manifest.name, "MangaAll");
assert.equal(manifest.publication, "development", "unsigned code10 must never publish on push");
assert.deepEqual(manifest.version, { name: "0.5.5-dev", code: 10 });
assert.deepEqual(manifest.capabilities.map((cap) => cap.id), [
  "reading.lookup", "reading.chapters", "reading.pages",
]);
assert.deepEqual(manifest.contentLanguages, ["en", "pt-br"]);
const origins = new Set(manifest.permissions.network.origins);
for (const origin of ["https://api.mangadex.org", "https://mangadot.net", "https://mangafire.to"]) {
  assert.ok(origins.has(origin), "a source must be granted in the single signed manifest");
}

const { createMangaAllReading } = await import(pathToFileURL(path.join(dir, "modules/router.js")).href);
const actual = (await import(pathToFileURL(path.join(dir, "main.js")).href)).default;
assert.deepEqual(Object.keys(actual), ["reading"], "the single SCRIPT entrypoint exports one provider");
for (const capability of ["lookup", "chapters", "pages"]) {
  assert.equal(typeof actual.reading[capability], "function", "missing " + capability + " export");
}

const workIds = ["mangadex:11111111-2222-4333-8444-555555555555", "mangadot:317", "mangafire:example"];
const calls = [];
const adapters = Object.fromEntries(["mangadex", "mangadot", "mangafire"].map((source, i) => [
  source, {
    async lookup(req) {
      calls.push(["lookup", source, req.cursor ?? null]);
      return { items: [{
        externalWorkId: source === "mangafire" ? "example" : workIds[i],
        title: "Example", aliases: [], language: source === "mangafire" ? "en" : null,
      }], nextCursor: source === "mangadex" && req.cursor == null ? "20" : null };
    },
    async chapters(req) {
      calls.push(["chapters", source, req.binding.externalWorkId]);
      return { items: [{ providerChapterId: source === "mangafire" ? "987" : source + ":123",
        rawLabel: "Ch. 1", rawNumber: 1, language: "en" }], nextCursor: null };
    },
    ...(source === "mangafire" || source === "mangadot" ? { async pages(req) {
      calls.push(["pages", source, req.providerChapterId, req.binding.externalWorkId]);
      return { type: "page_list", pages: [{
        url: source === "mangafire" ? "https://mfcdn.cc/image/1.png" : "https://mangadot.net/pages/1.png",
        headers: { Referer: source === "mangafire" ? "https://mangafire.to" : "https://mangadot.net" },
      }] };
    } } : {}),
  },
]));

const reading = createMangaAllReading(adapters);
const page1 = await reading.lookup({ titles: ["Example"] });
assert.deepEqual(page1.items.map(({ externalWorkId }) => externalWorkId), workIds);
assert.ok(page1.nextCursor);
assert.ok(page1.nextCursor.length < 256);
assert.deepEqual(calls.filter(([kind]) => kind === "lookup").map((v) => v[1]),
  ["mangadex", "mangadot", "mangafire"]);
const page2 = await reading.lookup({ titles: ["Example"], cursor: page1.nextCursor });
assert.deepEqual(page2.items.map(({ externalWorkId }) => externalWorkId), [workIds[0]]);
assert.equal(page2.nextCursor, null);
assert.deepEqual(calls.filter(([kind]) => kind === "lookup").slice(3),
  [["lookup", "mangadex", "20"]], "completed sources must not be re-queried");

// A source search can return unrelated ranked hits. Those must not become
// candidates for edition confirmation or pollute automatic source association.
const misleadingLookup = createMangaAllReading({
  mangadot: { async lookup() {
    return { items: [
      { externalWorkId: "mangadot:4827", title: "Patati patata" },
      { externalWorkId: "mangadot:4000", title: "Vagabond" },
      { externalWorkId: "mangadot:4001", title: "Vagabond (Hong Kong Colored Version)" },
    ], nextCursor: null };
  } },
  mangafire: { async lookup() {
    return { items: [{ externalWorkId: "vagabond", title: "Vagabond" }], nextCursor: null };
  } },
  mangadex: { async lookup() { return { items: [], nextCursor: null }; } },
});
assert.deepEqual(
  (await misleadingLookup.lookup({ titles: ["Vagabond"] })).items.map((x) => x.title),
  ["Vagabond", "Vagabond (Hong Kong Colored Version)", "Vagabond"],
  "unrelated titles must not be exposed as source candidates",
);
assert.deepEqual(
  (await misleadingLookup.lookup({ titles: ["Vagabond", "Patati patata"] })).items.map((x) => x.title),
  ["Patati patata", "Vagabond", "Vagabond (Hong Kong Colored Version)", "Vagabond"],
  "an explicit alternative title must remain valid discovery evidence",
);

// A short title must not match unrelated works containing the same word.
// Explicit source-attested edition qualifiers and exact aliases stay discoverable.
const monsterScoped = createMangaAllReading({
  mangadex: { async lookup() { return { items: [
    { externalWorkId: "mangadex:exact", title: "MONSTER" },
    { externalWorkId: "mangadex:unrelated", title: "Monster X Monster" },
    { externalWorkId: "mangadex:perfect", title: "MONSTER (Perfect Edition)" },
    { externalWorkId: "mangadex:other", title: "My Covenant with the Monster Lord" },
  ], nextCursor: null }; } },
  mangadot: { async lookup() { return { items: [
    { externalWorkId: "mangadot:7", title: "Monster no Niku" },
    { externalWorkId: "mangadot:8", title: "Other Story", aliases: ["Monster"] },
  ], nextCursor: null }; } },
  mangafire: { async lookup() { return { items: [], nextCursor: null }; } },
});
assert.deepEqual(
  (await monsterScoped.lookup({ titles: ["Monster"] })).items.map(x => x.externalWorkId),
  ["mangadex:exact", "mangadex:perfect", "mangadot:8"],
  "word-in-title results are unrelated works, while named editions and exact aliases remain",
);
const dragonBallScoped = createMangaAllReading({
  mangadex: { async lookup() { return { items: [
    { externalWorkId: "mangadex:ball", title: "Dragon Ball" },
    { externalWorkId: "mangadex:super", title: "Dragon Ball Super" },
  ], nextCursor: null }; } },
  mangadot: { async lookup() { return { items: [], nextCursor: null }; } },
  mangafire: { async lookup() { return { items: [], nextCursor: null }; } },
});
assert.deepEqual(
  (await dragonBallScoped.lookup({ titles: ["Dragon Ball"] })).items.map(x => x.externalWorkId),
  ["mangadex:ball"],
  "a sequel sharing all query tokens cannot become the original editorial work",
);

// Regression: a valid merged search may exceed the SCRIPT runtime's 64 KiB
// response envelope. Page source results without dropping source-scoped work
// identities, and preserve alias/edition evidence instead of truncating it.
const bulkyAliases = Array.from({ length: 6 }, (_, i) =>
  "Example alternative " + i + " " + "x".repeat(950));
const manyDexWorks = Array.from({ length: 20 }, (_, i) => ({
  externalWorkId: "mangadex:source-work-" + i,
  title: "Example",
  aliases: bulkyAliases,
  language: null,
}));
const budgetCalls = [];
const budgeted = createMangaAllReading({
  mangadex: { async lookup(req) {
    budgetCalls.push(["mangadex", req.cursor ?? null]);
    return { items: manyDexWorks, nextCursor: null };
  } },
  mangadot: { async lookup(req) {
    budgetCalls.push(["mangadot", req.cursor ?? null]);
    return { items: [{ externalWorkId: "mangadot:317", title: "Example" }], nextCursor: null };
  } },
  mangafire: { async lookup(req) {
    budgetCalls.push(["mangafire", req.cursor ?? null]);
    return { items: [{ externalWorkId: "fire-example", title: "Example", language: "en" }], nextCursor: null };
  } },
});
const expectedIds = [...manyDexWorks.map(item => item.externalWorkId),
  "mangadot:317", "mangafire:fire-example"];
const recoveredIds = [];
let budgetCursor = null, budgetPages = 0;
do {
  const page = await budgeted.lookup({ titles: ["Example"], cursor: budgetCursor });
  budgetPages++;
  assert.ok(JSON.stringify(page).length < 64 * 1024,
    "one SCRIPT lookup response must fit Host runtime limit");
  recoveredIds.push(...page.items.map(item => item.externalWorkId));
  for (const item of page.items.filter(item => item.externalWorkId.startsWith("mangadex:"))) {
    assert.deepEqual(item.aliases, bulkyAliases,
      "pagination must never discard source-attested aliases or edition hints");
  }
  budgetCursor = page.nextCursor;
  assert.ok(budgetPages <= 8, "Host bounds lookup continuation to eight pages");
} while (budgetCursor);
assert.ok(budgetPages > 1, "fixture must exercise a continuation, not a small page");
assert.equal(new Set(recoveredIds).size, recoveredIds.length,
  "continuation cannot duplicate previously returned source IDs");
assert.deepEqual(recoveredIds.slice().sort(), expectedIds.slice().sort(),
  "every source candidate must survive pagination, regardless of page interleaving");
assert.ok(budgetCalls.filter(([source]) => source === "mangadot").length >= 1);
assert.ok(budgetCalls.filter(([source]) => source === "mangafire").length >= 1);

// Regression from the v3 A54 smoke: JavaScript character lengths are not
// UTF-8 bytes. MangaDex multilingual aliases can overflow the 64 KiB Host
// result limit even when the merged string is under 48 KiB characters.
for (const scenario of [
  { name: "utf8-multilingual", worksPerSource: 25, aliases: ["ワンパンマン".repeat(100)] },
  { name: "many-small-works", worksPerSource: 200, aliases: [] },
]) {
  const sources = Object.fromEntries(["mangadex", "mangadot", "mangafire"].map(source => [
    source, { async lookup() {
      return { items: Array.from({ length: scenario.worksPerSource }, (_, i) => ({
        externalWorkId: source === "mangafire" ? "work-" + i : source + ":work-" + i,
        title: "Example",
        aliases: scenario.aliases,
      })), nextCursor: null };
    } },
  ]));
  const readingWithBudget = createMangaAllReading(sources);
  let next = null, pages = 0;
  const ids = [];
  do {
    const page = await readingWithBudget.lookup({ titles: ["Example"], cursor: next });
    assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") < 65536,
      scenario.name + " returned a response that the Host rejects");
    assert.ok(page.items.length <= 500,
      scenario.name + " returned more than Host's 500 candidates per page");
    ids.push(...page.items.map(item => item.externalWorkId));
    next = page.nextCursor;
    assert.ok(++pages <= 8, "continuation must be bounded");
  } while (next);
  assert.equal(new Set(ids).size, scenario.worksPerSource * 3,
    scenario.name + " must preserve every source identity across pages");
  assert.equal(ids.length, scenario.worksPerSource * 3);
  assert.ok(pages > 1, scenario.name + " should require pagination");
}

const binding = (id) => ({ providerId: manifest.id, facetId: "en", externalWorkId: id });
const dex = await reading.chapters({ binding: binding(workIds[0]) });
assert.equal(dex.items[0].providerChapterId, "mangadex:123");
const fire = await reading.chapters({ binding: binding(workIds[2]) });
assert.equal(fire.items[0].providerChapterId, "mangafire:987");
assert.deepEqual(calls.at(-1), ["chapters", "mangafire", "example"]);
const pages = await reading.pages({ binding: binding(workIds[2]), providerChapterId: fire.items[0].providerChapterId });
assert.equal(pages.pages.length, 1);
assert.deepEqual(calls.at(-1), ["pages", "mangafire", "987", "example"]);
const dotPages = await reading.pages({ binding: binding(workIds[1]), providerChapterId: "mangadot:uploads:8001" });
assert.equal(dotPages.pages.length, 1);
assert.deepEqual(calls.at(-1), ["pages", "mangadot", "mangadot:uploads:8001", workIds[1]]);
await assert.rejects(reading.pages({ binding: binding(workIds[1]), providerChapterId: "mangafire:987" }), /chapter source mismatch/i);

await assert.rejects(reading.chapters({ binding: binding("mangaball:416") }), /unknown source|paused/i);
await assert.rejects(reading.chapters({ binding: binding("bad") }), /unknown source|invalid work/i);
await assert.rejects(reading.chapters({ binding: binding("mangafire:") }), /invalid work/i);
await assert.rejects(reading.chapters({ binding: binding(workIds[2].replace("example", "a/b")) }), /invalid work/i);
await assert.rejects(reading.pages({ binding: binding(workIds[2]), providerChapterId: "mangadex:123" }), /chapter source mismatch/i);
await assert.rejects(reading.pages({
  binding: binding(workIds[0]), providerChapterId: "mangadex:123",
}), /pages not available/i, "mock adapter without pages is not a real MangaDex Reader source");
await assert.rejects(reading.lookup({ titles: ["Example"], cursor: "{bad" }), /invalid cursor/i);
await assert.rejects(reading.lookup({ titles: ["Example"], cursor: JSON.stringify({ v: 1, remaining: { evil: "1" } }) }), /invalid cursor/i);
await assert.rejects(reading.lookup({ titles: [] }), /missing title/i);

const fail = () => { throw new Error("upstream unavailable"); };
const degraded = createMangaAllReading({
  mangadex: { lookup: fail }, mangadot: { lookup: fail },
  mangafire: adapters.mangafire,
});
assert.equal((await degraded.lookup({ titles: ["Example"] })).items[0].externalWorkId, workIds[2],
  "an unavailable source cannot suppress healthy reading alternatives");
// A partially failed source must not disappear silently from MangaAll lookup.
// Retry its exact source cursor once while healthy sources remain usable.
let dexAttempts = 0;
const intermittent = createMangaAllReading({
  mangadex: { async lookup(req) {
    dexAttempts++;
    assert.equal(req.cursor ?? null, null);
    if (dexAttempts === 1) throw new Error("temporary MangaDex failure");
    return { items: [{ externalWorkId: workIds[0], title: "Recovered", aliases: ["Example"] }], nextCursor: null };
  } },
  mangadot: { lookup: adapters.mangadot.lookup },
  mangafire: { lookup: adapters.mangafire.lookup },
});
const initialPartial = await intermittent.lookup({ titles: ["Example"] });
assert.deepEqual(initialPartial.items.map((item) => item.externalWorkId),
  [workIds[1], workIds[2]]);
assert.ok(initialPartial.nextCursor, "temporary source failures require a bounded recovery cursor");
const recovered = await intermittent.lookup({ titles: ["Example"], cursor: initialPartial.nextCursor });
assert.deepEqual(recovered.items.map((item) => item.externalWorkId), [workIds[0]]);
assert.equal(recovered.nextCursor, null);
assert.equal(dexAttempts, 2, "recovery re-queries only the failed source");

let alwaysFails = 0;
const boundedFailure = createMangaAllReading({
  mangadex: { async lookup() { alwaysFails++; throw new Error("still unavailable"); } },
  mangadot: { async lookup(req) {
    return { items: [{ externalWorkId: workIds[1], title: "Healthy", aliases: ["Example"] }],
      nextCursor: req.cursor == null ? "next" : null };
  } },
  mangafire: { lookup: adapters.mangafire.lookup },
});
const firstPartial = await boundedFailure.lookup({ titles: ["Example"] });
const secondPartial = await boundedFailure.lookup({ titles: ["Example"], cursor: firstPartial.nextCursor });
// Preserve healthy candidates seen on the retry page, but NEVER declare
// the whole three-source search complete. The next page must be a typed
// terminal error without any third upstream request.
assert.deepEqual(secondPartial.items.map(item => item.externalWorkId), [workIds[1]]);
assert.ok(secondPartial.nextCursor?.includes('"v":2'),
  "a deferred terminal failure is not a completed lookup");
const terminalPartial = await boundedFailure.lookup({
  titles: ["Example"], cursor: secondPartial.nextCursor,
});
assert.deepEqual(terminalPartial, {
  items: [], nextCursor: null, lookupFailureCode: "UNCLASSIFIED_ERROR",
}, "the original failure is delivered AFTER salvaging valid candidates");
assert.equal(alwaysFails, 2, "failed source gets exactly one retry, not a third request");

// Deferred V1 continuation is closed, bounded, and language-scoped. A forged
// terminal error can at most fail closed; it cannot create a success snapshot.
const validTerminal = JSON.parse(secondPartial.nextCursor);
assert.equal(validTerminal.v, 2);
assert.deepEqual(validTerminal.remaining, {});
assert.equal(validTerminal.facet, null);
for (const mutation of [
  { ...validTerminal, v: 3 },
  { ...validTerminal, extra: "unreviewed" },
  { ...validTerminal, failure: { code: "CANONICAL_GRANTED", status: null } },
  { ...validTerminal, failure: { code: "HTTP_ERROR", status: 200 } },
  { ...validTerminal, failure: { code: "INVALID_RESPONSE", status: 403 } },
  { ...validTerminal, remaining: { outsider: "25" } },
  { ...validTerminal, remaining: { mangadex: { c: "25", r: 2 } } },
  { ...validTerminal, facet: "en" },
]) {
  await assert.rejects(
    boundedFailure.lookup({ titles: ["Example"], cursor: JSON.stringify(mutation) }),
    /invalid cursor/i,
    "malformed/tampered deferred state cannot report success",
  );
}
await assert.rejects(boundedFailure.lookup({
  titles: ["Example"], cursor: "x".repeat(513),
}), /invalid cursor/i, "oversized cursor fails closed");

// Exercise a *deferred* failure while a healthy source page requires multiple
// 48KiB result chunks. No source IDs, long aliases or evidence may be dropped
// or duplicated merely because MangaFire exhausted its one permitted retry.
const oversizeAliases = Array.from({ length: 6 }, (_, i) => "Alias " + i + " " + "x".repeat(840));
const spillItems = Array.from({ length: 12 }, (_, i) => ({
  externalWorkId: "mangadex:spill-" + i, title: "Example", aliases: oversizeAliases,
}));
const spillCalls = [];
const spill = createMangaAllReading({
  mangadex: { async lookup(req) {
    spillCalls.push(["mangadex", req.cursor]);
    return req.cursor == null
      ? { items: [], nextCursor: "25" }
      : { items: spillItems, nextCursor: null };
  } },
  mangadot: { async lookup(req) {
    spillCalls.push(["mangadot", req.cursor]);
    return { items: [], nextCursor: null };
  } },
  mangafire: { async lookup(req) {
    spillCalls.push(["mangafire", req.cursor]);
    throw Error("MangaAll HTTP 403");
  } },
});
let spillCursor = null;
const spillIds = [];
let spillPages = 0, sawDeferred = false;
do {
  const step = await spill.lookup({ titles: ["Example"], requestedLanguage: "en", cursor: spillCursor });
  spillPages++;
  spillIds.push(...step.items.map(item => item.externalWorkId));
  if (step.nextCursor !== null) {
    const decoded = JSON.parse(step.nextCursor);
    if (decoded.v === 2) {
      sawDeferred = true;
      assert.equal(decoded.facet, "en");
      assert.equal(decoded.failure.code, "CHALLENGE_BLOCKED");
      assert.equal(decoded.failure.status, 403);
      await assert.rejects(spill.lookup({
        titles: ["Example"], requestedLanguage: "pt-br", cursor: step.nextCursor,
      }), /invalid cursor/i, "English deferred cursor cannot be resumed in Portuguese");
    }
  } else {
    assert.deepEqual(step, {
      items: [], nextCursor: null, lookupFailureCode: "CHALLENGE_BLOCKED", lookupHttpStatus: 403,
    }, "only a typed source error, never a completed inventory, terminates the spill");
  }
  spillCursor = step.nextCursor;
  assert.ok(spillPages <= 8, "deferred salvage must fit the Host's eight-page lookup budget");
} while (spillCursor);
assert.equal(sawDeferred, true);
assert.ok(spillPages >= 4, "exercise an actual split, not just the empty deferred terminal");
assert.equal(new Set(spillIds).size, spillIds.length, "no source chapter/work ID duplicates");
assert.deepEqual(spillIds.slice().sort(), spillItems.map(item => item.externalWorkId).sort(),
  "source-scoped candidates and aliases survive all 48KiB partial pages");
assert.equal(spillCalls.filter(([source]) => source === "mangafire").length, 2,
  "MangaFire is never re-requested after exhausted retry");
assert.ok(spillCalls.filter(([source]) => source === "mangadex").length <= 4,
  "only bounded source-page re-fetching is allowed");

// Multiple independently blocked sources with different causes must retain an
// UNCLASSIFIED terminal verdict, not misattribute every source to HTTP403.
let mixedAttempts = 0;
const mixedTerminal = createMangaAllReading({
  mangadex: { async lookup({ cursor }) {
    return cursor == null
      ? { items: [], nextCursor: "25" }
      : { items: [{ externalWorkId: "mangadex:mixed-25", title: "Example" }], nextCursor: null };
  } },
  mangadot: { async lookup() {
    throw Error("MangaAll invalid source lookup response");
  } },
  mangafire: { async lookup() {
    mixedAttempts++; throw Error("MangaAll HTTP 403");
  } },
});
const mixedFirst = await mixedTerminal.lookup({ titles: ["Example"] });
const mixedSecond = await mixedTerminal.lookup({ titles: ["Example"], cursor: mixedFirst.nextCursor });
assert.deepEqual(mixedSecond.items.map(x => x.externalWorkId), ["mangadex:mixed-25"]);
assert.ok(mixedSecond.nextCursor);
const mixedFinal = await mixedTerminal.lookup({ titles: ["Example"], cursor: mixedSecond.nextCursor });
assert.deepEqual(mixedFinal, {
  items: [], nextCursor: null, lookupFailureCode: "UNCLASSIFIED_ERROR",
}, "mixed failure types must not be blamed on one source");
assert.equal(mixedAttempts, 2);


// In the real A54 capture Enen no Shouboutai had a MangaFire/en original HID
// (z1r3l), but the English lookup only surfaced Fan Colored alternatives.
// This models the *transport-failure possibility*, not an assertion that the
// physical source actually failed: do not invent candidate identities.
let fireAttempts = 0;
const enenUnavailable = createMangaAllReading({
  mangadex: { async lookup() { return { items: [], nextCursor: null }; } },
  mangadot: { async lookup() { return { items: [], nextCursor: null }; } },
  mangafire: { async lookup() {
    fireAttempts++;
    throw new Error("MangaAll HTTP 503");
  } },
});
const firstEnen = await enenUnavailable.lookup({
  titles: ["Enen no Shouboutai"], requestedLanguage: "en",
});
assert.deepEqual(firstEnen.items, []);
assert.ok(firstEnen.nextCursor, "failed MangaFire source requires bounded retry");
const exhaustedEnen = await enenUnavailable.lookup({
  titles: ["Enen no Shouboutai"], requestedLanguage: "en", cursor: firstEnen.nextCursor,
});
assert.deepEqual(exhaustedEnen, {
  items: [], nextCursor: null, lookupFailureCode: "HTTP_ERROR", lookupHttpStatus: 503,
}, "MangaFire HTTP 503 cannot become a completed zero-chapter edition lookup");
assert.equal(fireAttempts, 2, "MangaFire retry remains bounded");

const down = createMangaAllReading({
  mangadex: { lookup: fail }, mangadot: { lookup: fail }, mangafire: { lookup: fail },
});
// The A54 v0.4 smoke produced repeated generic SCRIPT_ERROR during lookup.
// If every internal source fails, surface an existing typed Host error envelope,
// not a script crash or a deceptive complete-empty edition search.
assert.deepEqual(await down.lookup({ titles: ["Example"] }), {
  items: [], nextCursor: null, lookupFailureCode: "UNCLASSIFIED_ERROR",
});
const allBlocked = createMangaAllReading({
  mangadex: { async lookup() { throw new Error("MangaAll HTTP 403"); } },
  mangadot: { async lookup() { throw new Error("MangaAll HTTP 403"); } },
  mangafire: { async lookup() {
    return { items: [], nextCursor: null, lookupFailureCode: "CHALLENGE_BLOCKED", lookupHttpStatus: 403 };
  } },
});
assert.deepEqual(await allBlocked.lookup({ titles: ["Example"] }), {
  items: [], nextCursor: null, lookupFailureCode: "CHALLENGE_BLOCKED", lookupHttpStatus: 403,
}, "three independently verified challenge responses must preserve their closed failure cause");
const inconsistentFailures = createMangaAllReading({
  mangadex: { async lookup() { throw new Error("MangaAll HTTP 403"); } },
  mangadot: { async lookup() { throw new Error("MangaAll invalid JSON"); } },
  mangafire: { async lookup() { throw new Error("unrecognized upstream failure"); } },
});
assert.deepEqual(await inconsistentFailures.lookup({ titles: ["Example"] }), {
  items: [], nextCursor: null, lookupFailureCode: "UNCLASSIFIED_ERROR",
}, "mixed failures must never claim that all sources were challenged");
const allInvalid = createMangaAllReading(Object.fromEntries(
  ["mangadex", "mangadot", "mangafire"].map(source => [source,
    { async lookup() { throw new Error("MangaAll invalid JSON"); } }]),
));
assert.deepEqual(await allInvalid.lookup({ titles: ["Example"] }), {
  items: [], nextCursor: null, lookupFailureCode: "INVALID_RESPONSE",
}, "invalid JSON across all sources must not be hidden as SCRIPT_ERROR");


// Reproduce a REAL A54 cross-facet leak, without fabricating rival HIDs:
// Fire Force / Enen no Shouboutai had MangaFire HID z1r3l tagged "en"
// on the Portuguese work lookup and Host rejected FACET_MISMATCH.
// English-only MangaFire must not be called for pt-br at all.
const enenLookups = [];
const enenByFacet = createMangaAllReading({
  mangadex: { async lookup() {
    enenLookups.push("mangadex"); return { items: [], nextCursor: null };
  } },
  mangadot: { async lookup() {
    enenLookups.push("mangadot"); return { items: [], nextCursor: null };
  } },
  mangafire: { async lookup() {
    enenLookups.push("mangafire");
    return { items: [{ externalWorkId: "z1r3l", title: "Enen no Shouboutai",
      aliases: ["Fire Force"], language: "en" }], nextCursor: null };
  } },
});
const enenPortuguese = await enenByFacet.lookup({
  titles: ["Enen no Shouboutai"], requestedLanguage: "pt-br",
});
assert.deepEqual(enenPortuguese, { items: [], nextCursor: null },
  "MangaFire en is not Portuguese search evidence, even if ranked highly");
assert.deepEqual(enenLookups, ["mangadex", "mangadot"],
  "do not request English-only MangaFire while searching pt-br");
enenLookups.length = 0;
const enenEnglish = await enenByFacet.lookup({
  titles: ["Enen no Shouboutai"], requestedLanguage: "en",
});
assert.deepEqual(enenEnglish.items.map((v) => [v.externalWorkId, v.language]),
  [["mangafire:z1r3l", "en"]],
  "same source-attested HID remains discoverable for English without auto-binding");
assert.deepEqual(enenLookups, ["mangadex", "mangadot", "mangafire"]);
assert.equal(enenEnglish.nextCursor, null);
await assert.rejects(enenByFacet.lookup({
  titles: ["Enen no Shouboutai"], requestedLanguage: "pt-br",
  cursor: JSON.stringify({ v: 1, remaining: { mangafire: "2" } }),
}), /invalid cursor/i, "an English MangaFire cursor must not be reused in Portuguese");
await assert.rejects(enenByFacet.lookup({
  titles: ["Enen no Shouboutai"], requestedLanguage: "fr",
}), /unsupported lookup language/i, "unsupported language is not an exhaustive empty lookup");

// Language is a reading facet, not a provider identity. Enforce it before
// invoking upstream modules and never relabel a chapter from another language.
const languages = [];
const languageRouter = createMangaAllReading({
  mangadex: {
    async chapters(request) {
      languages.push(["mangadex", request.binding.facetId]);
      return { items: [
        { providerChapterId: "mangadex:en-1", rawNumber: 1, language: "en" },
        { providerChapterId: "mangadex:pt-1", rawNumber: 2, language: "pt-br" },
        { providerChapterId: "mangadex:unknown", rawNumber: 3, language: null },
      ], nextCursor: null };
    },
  },
  mangadot: { async chapters(request) {
    languages.push(["mangadot", request.binding.facetId]);
    return { items: [{ providerChapterId: "mangadot:1", rawNumber: 1, language: "pt-br" }], nextCursor: null };
  } },
  mangafire: {
    async chapters(request) {
      languages.push(["mangafire", request.binding.facetId]);
      return { items: [{ providerChapterId: "987", rawNumber: 1, language: "en" }], nextCursor: null };
    },
    async pages(request) {
      languages.push(["mangafire-pages", request.binding.facetId]);
      return { type: "page_list", pages: [{ url: "https://mfcdn.cc/image/1.jpg" }] };
    },
  },
});
const ptBinding = { ...binding(workIds[0]), facetId: "pt-br" };
const ptChapterPage = await languageRouter.chapters({ binding: ptBinding });
assert.deepEqual(ptChapterPage.items.map((item) => [item.providerChapterId, item.language]), [
  ["mangadex:pt-1", "pt-br"], ["mangadex:unknown", null],
], "do not expose English chapters as Portuguese, or relabel unknown language");
const enChapterPage = await languageRouter.chapters({ binding: binding(workIds[0]) });
assert.deepEqual(enChapterPage.items.map((item) => item.providerChapterId),
  ["mangadex:en-1", "mangadex:unknown"]);
await assert.rejects(languageRouter.chapters({
  binding: { ...binding(workIds[0]), facetId: "fr" },
}), /unsupported language/i);
await assert.rejects(languageRouter.chapters({
  binding: { ...binding(workIds[2]), facetId: "pt-br" },
}), /unsupported language/i);
await assert.rejects(languageRouter.pages({
  binding: { ...binding(workIds[2]), facetId: "pt-br" },
  providerChapterId: "mangafire:987",
}), /unsupported language/i);
assert.deepEqual(languages, [
  ["mangadex", "pt-br"], ["mangadex", "en"],
], "rejected facets must not call any upstream adapter");

const foreignOnly = createMangaAllReading({
  mangadex: { async chapters() {
    return {
      items: [{ providerChapterId: "mangadex:en-9", rawNumber: 9, language: "en" }],
      nextCursor: null,
    };
  } },
});
await assert.rejects(foreignOnly.chapters({ binding: ptBinding }), /language mismatch/i,
  "wrong-language-only response must not become a complete empty chapter inventory");

await assert.rejects(languageRouter.chapters({
  binding: { ...binding(workIds[0]), facetId: null },
}), /missing language/i, "unknown language must not silently default to English");
// MangaDex is a full internal Reader source in the development-only package.
// The explicit source ID and language remain immutable throughout routing.
const dexRouted = createMangaAllReading({
  mangadex: { async pages(request) {
    assert.equal(request.binding.externalWorkId, workIds[0]);
    assert.equal(request.binding.facetId, "pt-br");
    assert.equal(request.providerChapterId, "mangadex:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    return { type: "page_list", pages: [{
      url: "https://uploads.mangadex.org/data/" + "a".repeat(32) + "/1.jpg",
    }] };
  } },
});
const realDexId = "mangadex:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const dexRoutedPages = await dexRouted.pages({
  binding: ptBinding, providerChapterId: realDexId,
});
assert.equal(dexRoutedPages.pages.length, 1);
await assert.rejects(dexRouted.pages({
  binding: binding(workIds[1]), providerChapterId: realDexId,
}), /chapter source mismatch|pages not available/i);
await assert.rejects(dexRouted.pages({
  binding: { ...ptBinding, facetId: "ja" }, providerChapterId: realDexId,
}), /unsupported language/i);

const fireKnown = await languageRouter.pages({
  binding: binding(workIds[2]), providerChapterId: "mangafire:987",
});
assert.equal(fireKnown.pages.length, 1);

// A real MangaDot image manifest can omit manga.id. Verify the chapter's
// exact work, endpoint kind, and attested language before exposing image URLs.
const realRequests = [];
let memberLanguage = "pt-br";
let memberWork = "317";
let declaredImageChapter = 8001;
globalThis.tsuzuki = { http: { async request(method, url) {
  realRequests.push(url);
  const pathname = new URL(url).pathname;
  const body = pathname === "/api/uploads/8001/images"
    ? { chapter: { id: declaredImageChapter }, images: [{ url: "/chapters/page1.webp" }] }
    : pathname === "/api/manga/317/chapters/list"
      ? (memberWork === "317" ? [{ id: 8001, source: "user", language: memberLanguage }] : [])
      : null;
  if (method !== "GET" || body === null) throw new Error("unexpected MangaDot request " + pathname);
  return JSON.stringify({ statusCode: 200, body: JSON.stringify(body) });
} } };
const dotBinding = { ...binding(workIds[1]), facetId: "pt-br" };
const verifiedDot = await actual.reading.pages({
  binding: dotBinding, providerChapterId: "mangadot:uploads:8001",
});
assert.equal(verifiedDot.pages.length, 1);
assert.equal(verifiedDot.pages[0].url, "https://mangadot.net/chapters/page1.webp");
assert.deepEqual(realRequests.map(url => new URL(url).pathname), [
  "/api/uploads/8001/images", "/api/manga/317/chapters/list",
], "image metadata without manga.id must be checked against the exact title's chapters");
declaredImageChapter = 8002;
const beforeForeignChapter = realRequests.length;
await assert.rejects(actual.reading.pages({
  binding: dotBinding, providerChapterId: "mangadot:uploads:8001",
}), /chapter mismatch/i, "image manifest must not claim a different chapter");
assert.equal(realRequests.length, beforeForeignChapter + 1,
  "foreign chapter must be rejected before a chapter-list verification request");
declaredImageChapter = 8001;
memberLanguage = "en";
await assert.rejects(actual.reading.pages({
  binding: dotBinding, providerChapterId: "mangadot:uploads:8001",
}), /work mismatch/i, "chapter from another language cannot become Portuguese Reader pages");
memberLanguage = "pt-br";
await assert.rejects(actual.reading.pages({
  binding: dotBinding, providerChapterId: "mangadot:chapters:8001",
}), /work mismatch|unexpected/i, "chapter kind must not cross uploads/chapters endpoints");

// MangaDex can credit several scanlation groups for the SAME reading chapter.
// These are chapter-source credits, not creators from a work-search candidate.
const dexSource = await import(pathToFileURL(path.join(
  dir, "modules/sources/mangadex/modules/mangadex.js"
)).href);
globalThis.tsuzuki = { http: { async request(method, url) {
  assert.equal(method, "GET");
  assert.equal(new URL(url).pathname, "/chapter");
  const body = { result: "ok", offset: 0, total: 2, data: [
    { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", type: "chapter",
      attributes: { chapter: "1", translatedLanguage: "pt-br" },
      relationships: [
        { type: "scanlation_group", attributes: { name: "Group Alpha" } },
        { type: "scanlation_group", attributes: { name: "Group Beta" } },
        { type: "scanlation_group", attributes: { name: "Group Alpha" } },
        { type: "scanlation_group", attributes: {} },
      ],
    },
    { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef", type: "chapter",
      attributes: { chapter: "2", translatedLanguage: "pt-br" },
      relationships: [],
    },
  ] };
  return JSON.stringify({ statusCode: 200, body: JSON.stringify(body) });
} } };
const creditedChapters = await dexSource.chapters({ binding: {
  externalWorkId: workIds[0], facetId: "pt-br",
} });
assert.deepEqual(creditedChapters.items.map(ch => ch.scanlationGroup), [
  "Group Alpha, Group Beta", null,
], "credit all attested chapter groups once; never invent unknown credits");

// Actual MangaDex pages adapter (not a mock): verify source, language, and
// per-chapter MangaDex@Home image metadata on the unified package.
const dexChapterId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const dexWorkId = "11111111-2222-4333-8444-555555555555";
let detailLanguage = "pt-br";
let detailWork = dexWorkId;
const dexRequests = [];
globalThis.tsuzuki = { http: { async request(method, url) {
  assert.equal(method, "GET");
  const path = new URL(url).pathname;
  dexRequests.push(path);
  const body = path === "/chapter/" + dexChapterId
    ? { result: "ok", data: { id: dexChapterId, type: "chapter",
      attributes: { translatedLanguage: detailLanguage },
      relationships: [{ type: "manga", id: detailWork }],
    } }
    : path === "/at-home/server/" + dexChapterId
      ? { result: "ok", baseUrl: "https://uploads.mangadex.org",
        chapter: { hash: "a".repeat(32), data: ["page1.jpg"] } }
      : null;
  if (!body) throw new Error("unexpected MangaDex request " + path);
  return JSON.stringify({ statusCode: 200, body: JSON.stringify(body) });
} } };
const exactDexBinding = { providerId: manifest.id, externalWorkId: workIds[0], facetId: "pt-br" };
const actualDexPages = await actual.reading.pages({
  binding: exactDexBinding, providerChapterId: "mangadex:" + dexChapterId,
});
assert.equal(actualDexPages.pages[0].url,
  "https://uploads.mangadex.org/data/" + "a".repeat(32) + "/page1.jpg");
assert.deepEqual(dexRequests, [
  "/chapter/" + dexChapterId, "/at-home/server/" + dexChapterId,
]);
detailLanguage = "en";
const beforeWrongLanguage = dexRequests.length;
assert.deepEqual(await actual.reading.pages({
  diagnosticsVersion: 2,
  binding: exactDexBinding, providerChapterId: "mangadex:" + dexChapterId,
}), { type: "page_failure", pageFailureStage: "CHAPTER_LANGUAGE_MISMATCH" },
  "MangaDex cannot serve English pages under a Portuguese facet");
assert.equal(dexRequests.length, beforeWrongLanguage + 1,
  "wrong-language chapter must stop before MangaDex@Home");
detailLanguage = "pt-br";
detailWork = "ffffffff-ffff-4fff-8fff-ffffffffffff";
assert.deepEqual(await actual.reading.pages({
  diagnosticsVersion: 2,
  binding: exactDexBinding, providerChapterId: "mangadex:" + dexChapterId,
}), { type: "page_failure", pageFailureStage: "CHAPTER_WORK_MISMATCH" },
  "foreign MangaDex chapter must be rejected");
assert.deepEqual(await actual.reading.pages({
  diagnosticsVersion: 2,
  binding: exactDexBinding, providerChapterId: "mangadex:invalid",
}), { type: "page_failure", pageFailureStage: "INVALID_CHAPTER_ID" },
  "invalid MangaDex chapter ID must fail before network");

// A fuzzy MangaFire hit on the first canonical spelling must not prevent an
// explicitly supplied alternative title from reaching a real exact source HID.
// Earlier behavior stopped after any nonempty search response, then the
// aggregator discarded the unrelated candidates and Reader had no source.
const fireSearches = [];
globalThis.tsuzuki = { http: { async request(method, url) {
  assert.equal(method, "GET");
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://mangafire.to");
  const reply = (body) => JSON.stringify({ statusCode: 200, body: JSON.stringify(body) });
  if (parsed.pathname === "/api/titles") {
    const term = parsed.searchParams.get("keyword");
    fireSearches.push(term);
    return reply({ items: [term === "Vagabond"
      ? { hid: "real-vagabond", slug: "vagabond", title: "Vagabond" }
      : { hid: "unrelated", slug: "unrelated", title: "Patati patata" }] });
  }
  if (parsed.pathname === "/api/titles/unrelated") {
    return reply({ data: { hid: "unrelated", title: "Patati patata" } });
  }
  throw new Error("unexpected MangaFire fixture request " + parsed.pathname);
} } };
const fireReader = (await import(pathToFileURL(path.join(
  dir, "modules/sources/mangafire/main.js",
)).href)).default.reading;
const fallback = await fireReader.lookup({ titles: ["Japanese Original", "Vagabond"] });
assert.deepEqual(fireSearches, ["Japanese Original", "Vagabond"],
  "fuzzy first-title responses must not suppress exact alternative-title search");
assert.deepEqual(fallback.items.map((item) => item.title), ["Vagabond"],
  "unrelated hits must not consume the identity or enrichment budget");

// A54 0.5.1: Koe no Katachi has one corroborated MangaFire work but the
// unified search is partial. A source-side English chapter preview must not
// require a *second MangaFire HID* before provisional evidence can be read.
// This preview is NOT a canonical edition decision or Reader authorization.
let singleSourceHasChapters = true;
let singleSourcePreviewCalls = 0;
globalThis.tsuzuki = { http: { async request(method, url) {
  assert.equal(method, "GET");
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://mangafire.to");
  const ok = (body) => JSON.stringify({ statusCode: 200, body: JSON.stringify(body) });
  if (parsed.pathname === "/api/titles") {
    return ok({ items: [{ hid: "7p56", title: "Koe no Katachi", slug: "koe-no-katachi" }] });
  }
  if (parsed.pathname === "/api/titles/7p56") {
    return ok({ data: { hid: "7p56", title: "Koe no Katachi",
      aliases: ["A Silent Voice"], authors: ["Yoshitoki Ooima"] } });
  }
  if (parsed.pathname === "/api/titles/7p56/chapters") {
    singleSourcePreviewCalls++;
    assert.equal(parsed.searchParams.get("language"), "en");
    return ok({ items: singleSourceHasChapters
      ? [{ id: "ch-1", number: 1, language: "en" }] : [], meta: { hasNext: false } });
  }
  throw new Error("unexpected single-source coverage request " + parsed.pathname);
} } };
const singleSourceRequest = { titles: ["Koe no Katachi"],
  diagnosticsVersion: 1, requestedLanguage: "en",
  coverageEvidenceVersion: 1, editorialEvidenceVersion: 1 };
const oneReadable = (await fireReader.lookup(singleSourceRequest)).items;
assert.equal(oneReadable.length, 1);
assert.deepEqual(oneReadable[0].authors, ["Yoshitoki Ooima"]);
assert.equal(oneReadable[0].detailOutcome, "VERIFIED_WITH_ALIASES",
  "single-source coverage requires verified source details");
assert.equal(singleSourcePreviewCalls, 1,
  "an explicit preview request should fetch one verified source chapter page");
assert.equal(oneReadable[0].coverageOutcome, "OBSERVED",
  "one verified source HID still needs positive chapter evidence when unified discovery is partial");
assert.equal(oneReadable[0].coverageObservedCount, 1);
assert.equal(singleSourcePreviewCalls, 1);
singleSourceHasChapters = false;
const oneEmpty = (await fireReader.lookup(singleSourceRequest)).items;
assert.equal(oneEmpty[0].coverageOutcome, "EMPTY",
  "a complete-empty source must not be reported as readable");
assert.equal(oneEmpty[0].coverageObservedCount, 0);
assert.equal(singleSourcePreviewCalls, 2);
const withoutPreview = (await fireReader.lookup({ titles: ["Koe no Katachi"],
  diagnosticsVersion: 1, requestedLanguage: "en", editorialEvidenceVersion: 1 })).items;
assert.equal(withoutPreview[0].coverageOutcome, undefined,
  "legacy/no-opt-in callers must not perform chapter preview");
assert.equal(singleSourcePreviewCalls, 2);

// A source may report a versioned, content-free page failure for Host
// diagnostics. Reject unknown/extra fields instead of leaking upstream text.
const typedPageRouter = createMangaAllReading({
  mangadex: { async pages() {
    return { type: "page_failure", pageFailureStage: "AT_HOME_REQUEST_FAILED" };
  } },
});
const pageFailureRequest = {
  binding: { providerId: manifest.id, facetId: "en", externalWorkId: workIds[0] },
  providerChapterId: "mangadex:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
};
assert.deepEqual(await typedPageRouter.pages(pageFailureRequest), {
  type: "page_failure", pageFailureStage: "AT_HOME_REQUEST_FAILED",
});
for (const forged of [
  { type: "page_failure", pageFailureStage: "token=secret" },
  { type: "page_failure", pageFailureStage: "AT_HOME_REQUEST_FAILED", responseBody: "secret" },
]) {
  const untrusted = createMangaAllReading({ mangadex: { async pages() { return forged; } } });
  await assert.rejects(untrusted.pages(pageFailureRequest), /invalid page failure/,
    "typed source failure must not become a free-form diagnostic");
}

console.log("MangaAll single-package contract: passed");
