// Bounded, public, test-only HTTP Range diagnostic. Four exact requests total:
// approved MangaDot Naruto/Bleach chapter metadata only. No source body,
// chapter ID, raw URL, headers, cookies or unrestricted follow-up is exported.
// No bypass of HTTP challenges, no signing or Provider module changes.
import fs from 'node:fs';

const origin = 'https://mangadot.net';
const checks = [
  { tag: 'NARUTO_UNVERIFIED', workId: 109, start: 0, end: 65535 },
  { tag: 'NARUTO_UNVERIFIED', workId: 109, start: 65536, end: 131071 },
  { tag: 'BLEACH_UNVERIFIED', workId: 131, start: 0, end: 65535 },
  { tag: 'BLEACH_UNVERIFIED', workId: 131, start: 65536, end: 131071 },
];
const results = [], samples = new Map();
for (const item of checks) {
  const path = '/api/manga/' + item.workId + '/chapters/list?lang=en';
  const responseBase = {
    tag: item.tag, range: item.start === 0 ? 'FIRST_64K' : 'SECOND_64K',
    status: null, outcome: 'TRANSPORT_UNAVAILABLE',
    decodedBytes: 0, contentRangePresent: false,
    acceptRangesBytes: false, etagPresent: false,
  };
  let response;
  try {
    response = await fetch(origin + path, {
      method: 'GET', redirect: 'manual',
      headers: {
        'Accept': 'application/json',
        'Range': 'bytes=' + item.start + '-' + item.end,
        'User-Agent': 'Tsuzuki-MangaAll/0.1 (+https://github.com/jssantogit/providers-tsuzuki)',
      },
      signal: AbortSignal.timeout(12000),
    });
    responseBase.status = response.status;
    responseBase.contentRangePresent = response.headers.has('content-range');
    responseBase.acceptRangesBytes = response.headers.get('accept-ranges')?.toLowerCase() === 'bytes';
    responseBase.etagPresent = response.headers.has('etag');
    if (response.status === 206) {
      let chunks = [], size = 0;
      const reader = response.body?.getReader();
      if (!reader) {
        responseBase.outcome = 'PARTIAL_WITHOUT_STREAM';
      } else {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 65536) {
              responseBase.outcome = 'PARTIAL_EXCEEDED_REQUESTED_64K';
              await reader.cancel();
              break;
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        if (responseBase.outcome === 'TRANSPORT_UNAVAILABLE') {
          responseBase.outcome = size ? 'BOUNDED_PARTIAL_206' : 'EMPTY_PARTIAL_206';
          responseBase.decodedBytes = size;
          if (size) samples.set(item.tag + ':' + responseBase.range,
            Buffer.concat(chunks.map(x => Buffer.from(x))));
        }
      }
    } else {
      // On 200, server ignored Range. Never read its huge body.
      responseBase.outcome = response.status === 200 ? 'RANGE_IGNORED_FULL_200'
        : response.status === 403 ? 'UPSTREAM_403_CHALLENGE_OR_DENIAL'
        : response.status === 429 ? 'UPSTREAM_RATE_LIMIT'
        : response.status >= 300 && response.status < 400 ? 'UPSTREAM_REDIRECT_DENIED'
        : 'OTHER_HTTP_STATUS';
      await response.body?.cancel();
    }
  } catch {
    responseBase.outcome = 'TRANSPORT_OR_TIMEOUT_ERROR';
  } finally {
    results.push(responseBase);
    console.log('MANGAALL_RANGE_CAPABILITY|' + JSON.stringify(responseBase));
    try { await response?.body?.cancel(); } catch {}
  }
}
function state(tag) {
  const r = results.filter(x => x.tag === tag);
  if (r.length !== 2) return 'NOT_OBSERVED';
  if (!r.every(x => x.status === 206 && x.outcome === 'BOUNDED_PARTIAL_206'
        && x.contentRangePresent)) {
    return r.some(x => x.outcome === 'RANGE_IGNORED_FULL_200')
      ? 'RANGE_IGNORED' : 'RANGE_UNAVAILABLE_OR_UNATTESTED';
  }
  const one = samples.get(tag + ':FIRST_64K');
  const two = samples.get(tag + ':SECOND_64K');
  if (!one || !two || one.equals(two)) return 'RANGE_NOT_INDEPENDENT';
  return 'TWO_DISTINCT_206_RANGES_OBSERVED_NOT_SNAPSHOT_SAFE';
}
const output = {
  schema: 1, scope: 'MANGADOT_HTTP_RANGE_PUBLIC_METADATA_DIAGNOSTIC_ONLY',
  signedCode10: 'UNCHANGED',
  results, verdict: {
    naruto: state('NARUTO_UNVERIFIED'),
    bleach: state('BLEACH_UNVERIFIED'),
  },
};
fs.writeFileSync('mangaall-mangadot-range-capability.json', JSON.stringify(output,null,2) + '\n');
console.log('MANGAALL_RANGE_SUMMARY|' + JSON.stringify(output.verdict));
