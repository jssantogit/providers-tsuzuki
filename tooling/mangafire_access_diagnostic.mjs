// One-shot public MangaFire access diagnosis in this CI runner only.
// Never fetches candidate content, image bytes or browser challenges.
import fs from 'node:fs';
import { diagnoseMangaFireAccess } from './mangafire_access_probe_core.mjs';

if (process.argv.length !== 4 || process.argv[2] !== '--output' ||
    !/^[a-z0-9_.-]+\.json$/.test(process.argv[3])) {
  console.error('Usage: node tooling/mangafire_access_diagnostic.mjs --output access.json');
  process.exit(2);
}
const observed = await diagnoseMangaFireAccess();
const report = {
  observedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || 'local',
  ...observed,
};
fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
console.log('MangaFire public HTTP environment=' + observed.scope +
  ' result=' + observed.classification +
  ' homepage_http=' + String(observed.homepage.status ?? 'TRANSPORT') +
  ' api_http=' + String(observed.api.status ?? 'TRANSPORT') +
  ' site_challenge=' + observed.homepage.challenge +
  ' api_challenge=' + observed.api.challenge);
console.log('Browser Host session not tested; source content and Reader availability not inferred.');
