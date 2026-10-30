import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { trustedImageUrl as ballImageUrl } from "../providers/mangaall-ball/modules/http.js";
import { trustedImageUrl as dotImageUrl } from "../providers/mangaall-dot/modules/http.js";

// Offline contract only. Mirrors Host ProviderOriginRule's exact HTTPS,
// port-443 and wildcard-subdomain matching; never fetch upstream URLs.
function networkGrantCovers(rawUrl, origins) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  return origins.some((origin) => {
    const wildcard = origin.startsWith("https://*.");
    const host = origin.replace(/^https:\/\/(?:\*\.)?/, "").toLowerCase();
    return wildcard
      ? url.hostname !== host && url.hostname.endsWith("." + host)
      : url.hostname === host;
  });
}

const sourceCases = [
  { source: "mangadex", dir: "mangaall-dex", expectedOrigins: [
    "https://api.mangadex.org",
    "https://uploads.mangadex.org",
    "https://*.mangadex.network",
  ] },
  { source: "mangaball", dir: "mangaall-ball", expectedOrigins: ["https://mangaball.com"] },
  { source: "mangadot", dir: "mangaall-dot", expectedOrigins: ["https://mangadot.net"] },
];
const manifests = {};
for (const { source, dir, expectedOrigins } of sourceCases) {
  const dirPath = path.resolve("providers", dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(dirPath, "manifest.json"), "utf8"));
  manifests[source] = manifest;
  assert.deepEqual(manifest.permissions.network.origins, expectedOrigins,
    source + ": origin changes require separate evidence and review");
  assert.deepEqual(manifest.permissions.browser.origins, [],
    source + ": image access must not silently become a browser grant");
  assert.equal(manifest.publication, "development",
    source + ": do not publish the adapter before Reader and API acceptance");
  assert.deepEqual(manifest.capabilities.map(v => v.id), ["reading.lookup", "reading.chapters"],
    source + ": image-origin checks do not authorize reading.pages");
  const main = await import(pathToFileURL(path.join(dirPath, "main.js")).href);
  assert.equal(main.default.reading.pages, undefined,
    source + ": prototype Reader pages must not be advertised or invoked");
}

const grants = (source, url) => networkGrantCovers(url, manifests[source].permissions.network.origins);

// MangaDex@Home can select a first-party upload server or a scoped subdomain.
// No grant covers the apex, a sibling/lookalike host, HTTP or non-443 port.
assert.equal(grants("mangadex", "https://uploads.mangadex.org/data/hash/page.jpg"), true);
assert.equal(grants("mangadex", "https://node.mangadex.network/token/data/hash/page.jpg"), true);
assert.equal(grants("mangadex", "https://mangadex.network/token/page.jpg"), false);
assert.equal(grants("mangadex", "https://node.mangadex.network.evil.example/page.jpg"), false);
assert.equal(grants("mangadex", "https://node.mangadex.network:8443/page.jpg"), false);
assert.equal(grants("mangadex", "http://node.mangadex.network/page.jpg"), false);

// MangaBall chapter details may contain these image CDN origins, and the
// prototype validates their paths, but *validation is not permission*.
// Do not widen MangaBall grants based solely on Keiyoushi's implementation.
const firstPartyBall = ballImageUrl("/static/page.jpg", "https://mangaball.com");
const ballCdn = ballImageUrl(
  "https://gengar.poke-black-and-white.net/storage/page.webp",
  "https://mangaball.com",
);
const otherBallCdn = ballImageUrl(
  "https://node.red-and-blue.net/storage/page.webp",
  "https://mangaball.com",
);
assert.equal(grants("mangaball", firstPartyBall), true);
assert.equal(grants("mangaball", ballCdn), false,
  "external MangaBall CDN has not been granted by Host and cannot be made readable");
assert.equal(grants("mangaball", otherBallCdn), false,
  "no speculative wildcards or borrowed Keiyoushi permissions");
assert.equal(grants("mangaball", "https://mangaball.com.evil.example/page.jpg"), false);
assert.equal(grants("mangaball", "https://mangaball.com:8443/page.jpg"), false);
assert.throws(
  () => ballImageUrl("https://unrelated.example/storage/page.webp", "https://mangaball.com"),
  /untrusted image origin/i,
);

// MangaDot currently returns first-party image URLs only. A future CDN is a
// distinct permission-review event, not an implicit grant.
const dotFirstParty = dotImageUrl("/pages/001.jpg", "https://mangadot.net");
assert.equal(grants("mangadot", dotFirstParty), true);
assert.equal(grants("mangadot", "https://cdn.mangadot.net/pages/001.jpg"), false);
assert.equal(grants("mangadot", "https://mangadot.net.evil.example/pages/001.jpg"), false);

console.log("MangaAll image-origin contract: scoped MangaDex nodes; MangaBall CDNs ungranted; MangaDot first-party; Reader gated");
