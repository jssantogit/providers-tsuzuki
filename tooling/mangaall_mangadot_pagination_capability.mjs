// Test-only, opt-in API pagination capability experiment. No Provider changes.
// Five GETs to one fixed reviewed MangaDot chapter-list endpoint family.
// Never export response content, IDs, URLs, cookies, user data or CDN paths.
import fs from 'node:fs';
import { createHttpBridge } from './mangaall_live_probe_core.mjs';
import { describeMangaDotChapterListHttp, describeMangaDotChapterTransportFailure }
  from './mangaall_mangadot_chapter_http_shape.mjs';

const origin = 'https://mangadot.net';
const client = createHttpBridge({
  origin, maxRequests: 5, maxResponseBytes: 2 * 1024 * 1024, timeoutMs: 12000,
});
const headers = JSON.stringify({
  Accept: 'application/json', Origin: origin, Referer: origin + '/',
  'User-Agent': 'Tsuzuki-MangaAll/0.1 (+https://github.com/jssantogit/providers-tsuzuki)',
});
const requests = [
  ['NARUTO_UNVERIFIED_109', 'LIMIT50_PAGE1', 109, [['lang','en'],['limit',50],['page',1]]],
  ['NARUTO_UNVERIFIED_109', 'LIMIT50_PAGE2', 109, [['lang','en'],['limit',50],['page',2]]],
  ['NARUTO_UNVERIFIED_109', 'LIMIT50_OFFSET50', 109, [['lang','en'],['limit',50],['offset',50]]],
  ['BLEACH_UNVERIFIED_131', 'LIMIT50_PAGE1', 131, [['lang','en'],['limit',50],['page',1]]],
  ['BLEACH_UNVERIFIED_131', 'LIMIT50_OFFSET50', 131, [['lang','en'],['limit',50],['offset',50]]],
];
const observations = [], samples = new Map();
for (const [source, probe, work, params] of requests) {
  const query = new URLSearchParams(params.map(([k,v]) => [k,String(v)]));
  const pathname = '/api/manga/' + work + '/chapters/list';
  const url = origin + pathname + '?' + query.toString();
  let shape, sample = null;
  try {
    const raw = await client.request('GET', url, headers);
    shape = describeMangaDotChapterListHttp(raw);
    const envelope = JSON.parse(raw);
    // Compare in memory only; never store any chapter value or hash in artifacts.
    const body = JSON.parse(envelope.body);
    if (Array.isArray(body) && body.length && body.length <= 100 &&
        body.every(x => x && typeof x === 'object' &&
          (typeof x.id === 'number' || typeof x.id === 'string'))) {
      sample = body.map(x => String(x.id));
      samples.set(source + ':' + probe, sample);
    }
  } catch (error) {
    shape = describeMangaDotChapterTransportFailure(error);
  }
  const observation = { source, probe, ...shape };
  observations.push(observation);
  console.log('MANGAALL_MANGADOT_PAGINATION_SHAPE|' + JSON.stringify(observation));
}
function classify(source, firstKey, otherKey) {
  const first = observations.find(x => x.source === source && x.probe === firstKey);
  const other = observations.find(x => x.source === source && x.probe === otherKey);
  if (!first || !other) return 'NOT_OBSERVED';
  if (first.bodyKind === 'BRIDGE_RESPONSE_TOO_LARGE' ||
      other.bodyKind === 'BRIDGE_RESPONSE_TOO_LARGE') return 'NOT_BOUNDED_UNDER_2MIB';
  if (first.bodyKind !== 'ARRAY' || other.bodyKind !== 'ARRAY') return 'NOT_ROOT_ARRAY';
  if (first.count > 50 || other.count > 50) return 'LIMIT_IGNORED';
  const a = samples.get(source + ':' + firstKey), b = samples.get(source + ':' + otherKey);
  if (!a || !b || a.length === 0 || b.length === 0) return 'EMPTY_OR_UNVERIFIABLE';
  return a.length === b.length && a.every((v,i) => v === b[i])
    ? 'SAME_CHAPTER_SET' : 'DISTINCT_BOUNDED_SETS_POSSIBLE';
}
const results = {
  schema: 1, scope: 'SOURCE_UNVERIFIED_METADATA_ONLY_NO_CANONICAL_OR_READER',
  originalCode10Sha256: 'bcdfd03ac18c3cfdd0517e08b58dde7efa1f5baa874e93002af28e518860f95f',
  requests: observations,
  pagination: {
    narutoPage: classify('NARUTO_UNVERIFIED_109', 'LIMIT50_PAGE1', 'LIMIT50_PAGE2'),
    narutoOffset: classify('NARUTO_UNVERIFIED_109', 'LIMIT50_PAGE1', 'LIMIT50_OFFSET50'),
    bleachOffset: classify('BLEACH_UNVERIFIED_131', 'LIMIT50_PAGE1', 'LIMIT50_OFFSET50'),
  },
};
fs.writeFileSync('mangaall-mangadot-pagination-capability.json', JSON.stringify(results,null,2)+'\n');
console.log('MANGAALL_MANGADOT_PAGINATION_SUMMARY|' + JSON.stringify(results.pagination));
