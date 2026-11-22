// Source request caps for an explicitly selected, nonshipping MangaALL
// metadata-only run. This is a ceiling, not a promise of upstream availability.
// We split 30 works into 3 shards of exactly 10, avoiding a 30-work fanout
// from one CI runner and preserving three-source lookup identity evidence.
export const THIRTY_WORK_CAPACITY = Object.freeze({
  maxWorks: 30,
  recommendedShardCount: 3,
  recommendedMaxWorksPerShard: 10,
  maxGenericWorkMinutesPerShard: 45,
  perSourceRequestCeiling: 320,
  maxUnverifiedSourcePreviewPages: 2,
  publisherPermission: 'NONE',
  editionAuthority: 'NOT_GRANTED_BY_CAPACITY_PLANNING',
});
export function sourceRequestBudget(source, assignedWorks, custom) {
  if (!['MANGADEX', 'MANGADOT', 'MANGAFIRE'].includes(source) ||
      !Number.isInteger(assignedWorks) || assignedWorks < 0 ||
      assignedWorks > THIRTY_WORK_CAPACITY.maxWorks) {
    throw new Error('Invalid MangaALL source capacity argument');
  }
  if (!custom) return source === 'MANGAFIRE' ? 20 : 40;
  // The MangaFire challenge remains explicitly blocked and is not retried.
  // A request cap must never be interpreted as Cloudflare permission.
  if (source === 'MANGAFIRE') return Math.min(80, Math.max(20, 8 * assignedWorks));
  // 30 works are split into 3 shards: 10/source per shard. A ceiling of
  // 32 calls per work leaves room for up to 8 Host lookup pages + verified
  // details/chapter previews while retaining a hard 320-call ceiling.
  // Do NOT hide a real source quota or timeout behind unlimited retries.
  return Math.min(320, Math.max(120, 32 * assignedWorks));
}
export function capacity30Plan(works, shardCount = 3) {
  if (!Array.isArray(works) || works.length < 1 || works.length > 30 ||
      !Number.isInteger(shardCount) || shardCount < 1 || shardCount > 4) {
    throw new Error('Invalid MangaALL 30-work capacity plan');
  }
  const shards = Array.from({ length: shardCount }, (_, i) =>
    works.map((work, index) => ({ work, index }))
      .filter(({index}) => index % shardCount === i));
  if (works.length === 30 && shardCount !== 3) {
    // Avoid endorsing an unproven high fanout or 15+ serial works/shard.
    throw new Error('Thirty-work scale requires three bounded shards');
  }
  return {
    workCount: works.length,
    shardCount,
    shardSizes: shards.map(s => s.length),
    maxWorksPerShard: Math.max(...shards.map(s => s.length)),
    maxSourceCallsPerShard: shards.map(s => ({
      MANGADEX: sourceRequestBudget('MANGADEX', s.length, true),
      MANGADOT: sourceRequestBudget('MANGADOT', s.length, true),
      MANGAFIRE: sourceRequestBudget('MANGAFIRE', s.length, true),
    })),
    scope: 'OFFLINE_CAPACITY_ONLY_NO_SOURCE_OR_CANONICAL_EVIDENCE',
    limitations: [
      'REAL_UPSTREAM_429_403_AND_2MIB_LISTS_MAY_STILL_FAIL',
      'HOST_RUNTIME_64K_RESULTS_REMAIN_ENFORCED',
      'CHAPTER_EDITORIAL_BINDING_NOT_GRANTED',
      'NO_IMAGE_OR_CDN_PIXELS_FROM_THIS_PLAN',
    ],
  };
}
