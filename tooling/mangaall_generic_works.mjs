// Arbitrary, operator-supplied REAL work queries for the opt-in MangaAll
// live runner. No candidate IDs, aliases, authors or editions are fabricated.
// This module has no network calls or fixed title/case catalog dependencies.
import { createHash } from 'node:crypto';

const FORMAT = new Set([
  'unknown', 'manga', 'manhwa', 'manhua', 'webtoon', 'light_novel', 'web_novel',
]);
const PROSE = new Set(['light_novel', 'web_novel']);
const MAX_WORKS = 30;
const MAX_INPUT_BYTES = 8192;
const MAX_TITLE_LENGTH = 180;

const normalize = (title) => title.normalize('NFKC').trim()
  .replace(/\s+/gu, ' ').toLowerCase();

/**
 * Lines are either "Work Title" or "format :: Work Title".
 * Bare titles have UNKNOWN format, never assumed to be manga.
 * Every candidate/author/HID will be fetched at runtime from public sources;
 * nothing here attests independent canonical title identity.
 */
export function parseWorks(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES) {
    throw new Error('MangaAll live work input must be bounded UTF-8 text');
  }
  const lines = input.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > MAX_WORKS) {
    throw new Error('MangaAll live work count must be between 1 and 30');
  }
  const seen = new Set();
  return lines.map((line) => {
    let format = 'unknown';
    let title = line;
    if (line.includes('::')) {
      const parts = line.split('::');
      if (parts.length !== 2 || !FORMAT.has(parts[0].trim().toLowerCase())) {
        throw new Error('MangaAll live work format must be an allowed single prefix');
      }
      format = parts[0].trim().toLowerCase();
      title = parts[1].trim();
    }
    if (!title || title.length > MAX_TITLE_LENGTH ||
        /[\x00-\x1F\x7F]/u.test(title) ||
        /https?:\/\//iu.test(title) ||
        !/[\p{L}\p{N}]/u.test(title)) {
      throw new Error('MangaAll live work title is invalid or too long');
    }
    title = title.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const key = normalize(title);
    if (seen.has(key)) {
      throw new Error('MangaAll live work query duplicated');
    }
    seen.add(key);
    return {
      id: 'user-' + createHash('sha256').update(key).digest('hex').slice(0, 12),
      names: [title],
      work: null,
      format,
      probe: PROSE.has(format) ? 'discovery_only' : 'source_metadata',
      tags: ['USER_SUPPLIED_NO_CANONICAL_AUTHORITY'],
    };
  });
}

export function shardWorks(works, shardIndex, shardCount) {
  if (!Array.isArray(works) ||
      !Number.isInteger(shardCount) || shardCount < 1 || shardCount > 4 ||
      !Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error('MangaAll live shard index/count invalid');
  }
  return works.filter((_, index) => index % shardCount === shardIndex);
}
