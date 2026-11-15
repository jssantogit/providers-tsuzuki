// No fabricated manga candidates: this suite only checks closed HTTP transport diagnostics.
import assert from 'node:assert/strict';
import { diagnoseMangaFireAccess } from './mangafire_access_probe_core.mjs';

function response(status, type = 'application/json', challenge = false) {
  return { status, headers: {
    get: (name) => name.toLowerCase() === 'content-type' ? type
      : name.toLowerCase() === 'cf-mitigated' && challenge ? 'challenge' : null,
  }, body: { cancel: async () => {} } };
}
async function simulate(rootResponse, apiResponse) {
  const calls = [];
  const result = await diagnoseMangaFireAccess({
    fetchImpl: async (url, init) => {
      const target = new URL(url);
      assert.equal(target.origin, 'https://mangafire.to');
      assert.equal(init.redirect, 'manual', 'do not silently follow challenges');
      assert.equal(init.method, 'GET');
      assert.equal(init.credentials, 'omit', 'never carry browser identity into CI');
      assert.equal(Object.keys(init.headers).some(k => /cookie|authorization/i.test(k)), false);
      assert.ok(!target.hash);
      calls.push(target.pathname);
      if (target.pathname === '/') return rootResponse;
      assert.equal(target.pathname, '/api/titles');
      assert.equal(target.searchParams.get('keyword'), 'Oyasumi Punpun');
      assert.ok(target.searchParams.has('vrf'), 'probe real signed MangaFire API route');
      return apiResponse;
    },
  });
  assert.deepEqual(calls, ['/', '/api/titles'], 'exactly two public read-only requests');
  assert.equal(JSON.stringify(result).includes('vrf'), false, 'no raw signed URL in report');
  assert.equal(JSON.stringify(result).includes('Oyasumi Punpun'), false, 'no title in report');
  return result;
}
let r = await simulate(response(403, 'text/html'), response(403, 'text/html'));
assert.equal(r.classification, 'SITE_AND_API_DENIED');
assert.equal(r.homepage.status, 403);
assert.equal(r.api.status, 403);
assert.equal(r.browserSessionTested, false);
r = await simulate(response(200, 'text/html'), response(403, 'text/html'));
assert.equal(r.classification, 'API_ONLY_DENIED');
r = await simulate(response(200, 'text/html'), response(200));
assert.equal(r.classification, 'SIGNED_API_HTTP_AVAILABLE');
r = await simulate(response(200, 'text/html'), response(200, 'text/html', true));
assert.equal(r.classification, 'UPSTREAM_CHALLENGE');
r = await simulate(response(302, 'text/html'), response(403, 'text/html'));
assert.equal(r.classification, 'API_DENIED_SITE_UNRESOLVED');
r = await simulate(response(403, 'text/html', true), response(403, 'text/html'));
assert.equal(r.classification, 'UPSTREAM_CHALLENGE');
r = await simulate(response(503, 'text/html'), response(503, 'text/html'));
assert.equal(r.classification, 'UPSTREAM_UNAVAILABLE');
let count = 0;
r = await diagnoseMangaFireAccess({
  fetchImpl: async () => { count++; throw new Error('Private socket secret https://example.invalid'); },
});
assert.equal(count, 2, 'each route attempted independently');
assert.equal(r.classification, 'TRANSPORT_UNAVAILABLE');
assert.equal(JSON.stringify(r).includes('Private socket secret'), false);
assert.equal(JSON.stringify(r).includes('example.invalid'), false);
console.log('MangaFire access diagnostic transport-only regression: PASS (no real source claim)');
