import assert from "node:assert/strict";
import { createLiveProbeHost } from "./nyaa_live_probe_support.mjs";

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa">
  <channel>
    <title>Nyaa</title>
    <item>
      <title>Live Probe Test</title>
      <link>https://nyaa.si/download/1234567.torrent</link>
      <guid isPermaLink="true">https://nyaa.si/view/1234567</guid>
      <nyaa:infoHash>0123456789abcdef0123456789abcdef01234567</nyaa:infoHash>
      <nyaa:category>Literature - English-translated</nyaa:category>
      <nyaa:size>12 MiB</nyaa:size>
      <nyaa:seeders>2</nyaa:seeders>
      <nyaa:leechers>1</nyaa:leechers>
    </item>
  </channel>
</rss>`;

const networkRequests = [];
const diagnostics = [];
const host = createLiveProbeHost({
  requestTimeoutMs: 1000,
  fetchImpl: async (url, init) => {
    networkRequests.push({ url: String(url), init });
    return new Response(rss, { status: 200 });
  },
  onDiagnostic: (entry) => diagnostics.push(entry),
});

const rssResponse = JSON.parse(await host.http.request(
  "GET",
  "https://nyaa.si/?page=rss&c=3_1&f=0&q=Live%20Probe",
  JSON.stringify({ Accept: "application/rss+xml" }),
));
assert.equal(rssResponse.statusCode, 200);
assert.equal(rssResponse.body, rss);
assert.equal(networkRequests.length, 1, "RSS discovery must use the real network adapter");
assert.equal(networkRequests[0].init.headers.Accept, "application/rss+xml");
assert.ok(networkRequests[0].init.signal instanceof AbortSignal, "live network calls must remain bounded");

const detailResponse = JSON.parse(await host.http.request(
  "GET",
  "https://nyaa.si/view/1234567",
  JSON.stringify({ Accept: "text/html" }),
));
assert.equal(detailResponse.statusCode, 200);
assert.match(detailResponse.body, /live-probe-skip-detail/);
assert.equal(
  networkRequests.length,
  1,
  "detail enrichment must stay offline so the probe measures discovery without fan-out",
);

await host.log.info(JSON.stringify({
  event: "nyaa_discovery",
  phase: "primary_narrow",
  rawItemCount: 1,
  acceptedCandidateCount: 1,
  elapsedMs: 42,
}));
assert.deepEqual(diagnostics, [
  {
    event: "nyaa_discovery",
    phase: "primary_narrow",
    rawItemCount: 1,
    acceptedCandidateCount: 1,
    elapsedMs: 42,
  },
]);

console.log("Nyaa live probe host contract: OK");
