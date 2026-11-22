import assert from 'node:assert/strict';
import { exactlyMatchesRequestedContentRange as match, exactlyMatchesRequestedContentLength as length }
  from './mangaall_mangadot_http_range_contract.mjs';
assert.equal(match('bytes 0-65535/200000',0,65535),true);
assert.equal(match('bytes 65536-131071/200000',65536,131071),true);
for(const invalid of [
  'bytes 0-0/200000',
  'bytes 0-65535/*',
  'bytes 65536-131071/131071',
  'bytes 0-65535/65535',
  'bytes 0-65536/200000',
  'bytes -1-65535/200000',
  'bytes 0-65535/200000\r\n',
  'not a range',
  null,
]) assert.equal(match(invalid,0,65535),false, String(invalid));
assert.equal(match('bytes 0-65535/200000',65536,131071),false);
assert.equal(match('bytes 65536-131071/200000',0,65535),false);
assert.equal(match('bytes 0-65535/200000',0,65536),false);
assert.equal(match('bytes 0-65535/200000',-1,65535),false);
assert.equal(length(65536,0,65535),true);
assert.equal(length(1,0,65535),false);
assert.equal(length(65535,0,65535),false);
assert.equal(length(65537,0,65535),false);
assert.equal(length(65536,65536,131071),true);
console.log('MangaALL Range exact-offset and length fail-closed contract: PASS');
