// EXPERIMENTAL TOOLING ONLY. Never imported by the signed MangaALL Provider.
// Tests a bounded V1 chapter *output* cursor contract against Host 64 KiB.
// It DOES NOT solve MangaDot's oversized upstream HTTP feed or establish
// editorial/edition identity; an independently reviewed feed is still needed.
const MAX_SOURCE_ROWS = 16000;
// 4,341 real Bleach release rows exceed 32 * 128 = 4,096 rows.
// Keep output <48 KiB and dynamically stop earlier for verbose labels.
const MAX_PAGE_ITEMS = 256;
const MAX_PAGE_BYTES = 48 * 1024;
const CHAPTER_ID = /^mangadot:(?:uploads|chapters):[1-9][0-9]{0,15}$/;
const WORK_ID = /^mangadot:([1-9][0-9]{0,15})$/;
const LANGS = new Set(['en','pt-br']);

function countUtf8Bytes(str) {
  let bytes = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    bytes += cp <= 0x7F ? 1 : cp <= 0x7FF ? 2 : cp <= 0xFFFF ? 3 : 4;
  }
  return bytes;
}
function token(localId, lang, offset) {
  return 'c1:' + localId + ':' + lang + ':' + offset;
}
function offsetFromCursor(cursor, localId, lang, count) {
  if (cursor == null) return 0;
  const match = typeof cursor === 'string'
    ? /^c1:([1-9][0-9]{0,15}):(en|pt-br):([1-9][0-9]{0,4})$/.exec(cursor)
    : null;
  if (!match || match[1] !== localId || match[2] !== lang) {
    throw Error('UNTRUSTED_CHAPTER_CURSOR');
  }
  const offset = Number(match[3]);
  if (!Number.isSafeInteger(offset) || offset >= count) {
    throw Error('STALE_OR_OUT_OF_BOUNDS_CURSOR');
  }
  return offset;
}
export function experimentalPageChapterOutput(rows, opts) {
  const match = typeof opts?.workId === 'string' ? WORK_ID.exec(opts.workId) : null;
  if (!match || !LANGS.has(opts?.language) ||
      !Array.isArray(rows) || rows.length > MAX_SOURCE_ROWS) {
    throw Error('INVALID_EXPERIMENTAL_CHAPTER_INPUT');
  }
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        typeof row.providerChapterId !== 'string' ||
        !CHAPTER_ID.test(row.providerChapterId) ||
        seen.has(row.providerChapterId) ||
        typeof row.rawLabel !== 'string' || row.rawLabel.length > 4096 ||
        !Number.isFinite(row.rawNumber) || row.rawNumber < 0 ||
        (row.language != null && row.language !== opts.language)) {
      throw Error('INVALID_SOURCE_CHAPTER_OBSERVATION');
    }
    seen.add(row.providerChapterId);
  }
  const start = offsetFromCursor(opts.cursor, match[1], opts.language, rows.length);
  const selected = [];
  let cursorAfter = null;
  for (let i = start; i < rows.length && selected.length < MAX_PAGE_ITEMS; i++) {
    selected.push(rows[i]);
    const more = i + 1 < rows.length;
    const next = more ? token(match[1], opts.language, i + 1) : null;
    const probe = JSON.stringify({ items: selected, nextCursor: next });
    if (probe.length > MAX_PAGE_BYTES || countUtf8Bytes(probe) > MAX_PAGE_BYTES) {
      selected.pop();
      if (!selected.length) throw Error('CHAPTER_ITEM_EXCEEDS_HOST_SAFE_BUDGET');
      break;
    }
    cursorAfter = next;
  }
  if (selected.length === 0 && start < rows.length) {
    throw Error('NO_CURSOR_PROGRESS');
  }
  const result = { items: selected, nextCursor: cursorAfter };
  const output = JSON.stringify(result);
  if (output.length > MAX_PAGE_BYTES || countUtf8Bytes(output) > MAX_PAGE_BYTES) {
    throw Error('HOST_SAFE_BUDGET_BROKEN');
  }
  return result;
}
export const EXPERIMENTAL_LIMITS = Object.freeze({
  maxSourceRows: MAX_SOURCE_ROWS, maxPageItems: MAX_PAGE_ITEMS,
  maxOutputUtf8Bytes: MAX_PAGE_BYTES, hostProtocolMaxChars: 64 * 1024,
  authority: 'TOOLING_ONLY_NO_CANONICAL_OR_READER_GRANT',
});
