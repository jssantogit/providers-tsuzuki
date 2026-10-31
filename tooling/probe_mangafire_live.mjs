// Manual/branch-only live preflight. No tokens, cookies, user data, chapter
// pages or artwork. External MangaFire responses are untrusted test input.
import provider from "../providers/mangafire/main.js";

const seen = [];
globalThis.tsuzuki = {
  http: {
    async request(method, url, headersJson) {
      const target = new URL(url);
      if (method !== "GET" || target.protocol !== "https:" || target.hostname !== "mangafire.to") {
        throw new Error("Live preflight refused a non-allowlisted request");
      }
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      seen.push({ path: target.pathname, status: response.status });
      return JSON.stringify({ statusCode: response.status, body: await response.text() });
    },
  },
  browser: { async readText() { throw new Error("Interactive challenge unavailable in CI"); } },
};

let validLookups = 0;
for (const title of ["Vagabond", "Chainsaw Man"]) {
  seen.length = 0;
  try {
    const found = await provider.reading.lookup({ titles: [title] });
    const candidates = found.items
      .filter((item) => item.title.toLowerCase() === title.toLowerCase())
      .map(({ externalWorkId, title: name, aliases }) => ({
        hid: externalWorkId,
        title: name,
        editionHints: aliases.filter((a) => /colored|coloured|one.?shot|omnibus/i.test(a)).slice(0, 4),
        aliasCount: aliases.length,
      }));
    console.log(JSON.stringify({ query: title, matched: candidates, requests: seen }));
    validLookups++;
  } catch (e) {
    console.log(JSON.stringify({ query: title, error: String(e?.message || e).slice(0, 160), requests: seen }));
  }
}
if (validLookups === 0) process.exitCode = 1;
