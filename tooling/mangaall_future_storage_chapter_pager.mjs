// NONSHIPPING FUTURE-PROVIDER EXPERIMENT. Code10 must never import this.
// The host creates a fresh QuickJs isolate for each call, so a JS memory array
// cannot keep chapter pages between invocations. This prototype models the
// actual opt-in Provider storage quotas (64 KiB/value, 512 KiB/provider).
//
// Precondition not implemented here: a genuinely safe bounded upstream chapter
// acquisition mechanism. The signed Host HTTP text API caps at 192 KiB and
// MangaDot Bleach's chapter-list exceeds 2 MiB. This prototype does not
// resolve that upstream transport; it only proves safe, resumable output
// after another component has obtained and verified source metadata.

const KEY = 'mangaall_chapters_index_v1';
const PREFIX = 'mangaall_chapters_part_';
const WORK = /^mangadot:([1-9][0-9]{0,15})$/;
const CHAPTER = /^mangadot:(?:uploads|chapters):[1-9][0-9]{0,15}$/;
const TOKEN = /^p1:([1-9][0-9]{0,15}):(en|pt-br):([a-f0-9]{16}):([0-9]{1,5})$/;
const LANGS = new Set(['en', 'pt-br']);

export const FUTURE_SNAPSHOT_LIMITS = Object.freeze({
  maxWorkRows: 16000,
  maxOutputRows: 128,
  maxOutputBytes: 48 * 1024,
  maxStorageValueChars: 64 * 1024,
  maxStorageTotalChars: 512 * 1024,
  maxStoredSnapshotChars: 440 * 1024,
  maxStoredParts: 16,
  maxPartChars: 48 * 1024,
  snapshotTtlMs: 5 * 60 * 1000,
  hostRuntimeResponseChars: 64 * 1024,
  scope: 'FUTURE_UNSHIPPED_STORAGE_PERMISSION_REQUIRED',
});

function checkWork(workId, language) {
  const id = typeof workId === 'string' ? WORK.exec(workId)?.[1] : null;
  if (!id || !LANGS.has(language)) throw Error('INVALID_SOURCE_SCOPE');
  return id;
}
function verifyRows(rows, language) {
  if (!Array.isArray(rows) || rows.length > FUTURE_SNAPSHOT_LIMITS.maxWorkRows) {
    throw Error('INVALID_OR_OVERSIZED_SOURCE_PORTFOLIO');
  }
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        !CHAPTER.test(row.providerChapterId) ||
        seen.has(row.providerChapterId) ||
        typeof row.rawLabel !== 'string' || row.rawLabel.length > 4096 ||
        typeof row.rawNumber !== 'number' || !Number.isFinite(row.rawNumber) ||
        row.rawNumber < 0 || (row.language != null && row.language !== language)) {
      throw Error('INVALID_CHAPTER_EVIDENCE');
    }
    seen.add(row.providerChapterId);
  }
}
function chunksFor(rows) {
  let part = [], parts = [], first = 0, position = 0, total = 0;
  for (const row of rows) {
    const next = JSON.stringify([...part, row]);
    if (next.length > FUTURE_SNAPSHOT_LIMITS.maxPartChars) {
      if (!part.length) throw Error('CHAPTER_ROW_EXCEEDS_STORAGE_PAGE');
      const packed = JSON.stringify(part);
      parts.push({ start: first, count: part.length, value: packed });
      total += packed.length;
      first = position;
      part = [row];
      if (JSON.stringify(part).length > FUTURE_SNAPSHOT_LIMITS.maxPartChars) {
        throw Error('CHAPTER_ROW_EXCEEDS_STORAGE_PAGE');
      }
    } else {
      part.push(row);
    }
    position++;
  }
  if (part.length) {
    const packed = JSON.stringify(part);
    parts.push({ start: first, count: part.length, value: packed });
    total += packed.length;
  }
  if (parts.length > FUTURE_SNAPSHOT_LIMITS.maxStoredParts ||
      total > FUTURE_SNAPSHOT_LIMITS.maxStoredSnapshotChars) {
    throw Error('SNAPSHOT_EXCEEDS_PROVIDER_STORAGE_QUOTA');
  }
  return parts;
}
function parseIndex(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { throw Error('CORRUPT_SNAPSHOT_INDEX'); }
  if (!data || data.v !== 1 || !WORK.test(data.workId) ||
      !LANGS.has(data.language) || !/^[a-f0-9]{16}$/.test(data.generation) ||
      !Number.isInteger(data.count) || data.count < 0 || data.count > 16000 ||
      !Number.isSafeInteger(data.expiresAt) || data.expiresAt < 0 ||
      !Array.isArray(data.ranges) || data.ranges.length > 16) {
    throw Error('CORRUPT_SNAPSHOT_INDEX');
  }
  let expected = 0;
  for (const part of data.ranges) {
    if (!part || !Number.isInteger(part.start) || !Number.isInteger(part.count) ||
        part.count < 1 || part.start !== expected ||
        part.count > FUTURE_SNAPSHOT_LIMITS.maxWorkRows) throw Error('CORRUPT_SNAPSHOT_INDEX');
    expected += part.count;
  }
  if (expected !== data.count) throw Error('CORRUPT_SNAPSHOT_INDEX');
  return data;
}
function cursor(workId, language, generation, index) {
  return 'p1:' + workId.slice('mangadot:'.length) + ':' + language +
    ':' + generation + ':' + index;
}
function validateCursor(value, index, workId, language) {
  const match = typeof value === 'string' ? TOKEN.exec(value) : null;
  if (!match || match[1] !== workId.slice('mangadot:'.length) ||
      match[2] !== language || match[3] !== index.generation) {
    throw Error('STALE_OR_FOREIGN_CHAPTER_CURSOR');
  }
  const offset = Number(match[4]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= index.count) {
    throw Error('CHAPTER_CURSOR_OUT_OF_BOUNDS');
  }
  return offset;
}
export function createFutureCachedChapterPager({ storage, fetchRows, now, nonce }) {
  if (!storage || !['get','set','remove'].every(k => typeof storage[k] === 'function') ||
      typeof fetchRows !== 'function' || typeof now !== 'function' ||
      typeof nonce !== 'function') throw Error('INVALID_FUTURE_PAGER_DEPENDENCY');

  async function clearOld() {
    const existing = await storage.get(KEY);
    if (existing != null) {
      // An invalid index must never allow an untrusted number of deletions.
      // Clean only the fixed 16 part keys and the single index key.
      for (let i = 0; i < FUTURE_SNAPSHOT_LIMITS.maxStoredParts; i++) {
        await storage.remove(PREFIX + i);
      }
      await storage.remove(KEY);
    }
  }
  async function persist(workId, language, rows) {
    verifyRows(rows, language);
    const parts = chunksFor(rows);
    const generation = nonce();
    if (typeof generation !== 'string' || !/^[a-f0-9]{16}$/.test(generation)) {
      throw Error('INVALID_SNAPSHOT_GENERATION');
    }
    const instant = now();
    if (!Number.isSafeInteger(instant) || instant < 0) throw Error('INVALID_SNAPSHOT_CLOCK');
    const index = {
      v: 1, workId, language, generation,
      expiresAt: instant + FUTURE_SNAPSHOT_LIMITS.snapshotTtlMs,
      count: rows.length,
      ranges: parts.map(p => ({start:p.start,count:p.count})),
    };
    const serializedIndex = JSON.stringify(index);
    const total = parts.reduce((sum,p)=>sum+p.value.length,serializedIndex.length);
    if (total > FUTURE_SNAPSHOT_LIMITS.maxStorageTotalChars) {
      throw Error('SNAPSHOT_EXCEEDS_PROVIDER_STORAGE_QUOTA');
    }
    await clearOld();
    try {
      for(let i=0;i<parts.length;i++) {
        await storage.set(PREFIX+i, JSON.stringify({g:generation,rows:JSON.parse(parts[i].value)}));
      }
      await storage.set(KEY, serializedIndex); // Commit last; no premature complete snapshot.
    } catch {
      await clearOld();
      throw Error('SNAPSHOT_STORAGE_WRITE_FAILED');
    }
    return index;
  }
  async function readSlice(index, position) {
    const partIndex = index.ranges.findIndex(p =>
      position >= p.start && position < p.start+p.count);
    if(partIndex<0) throw Error('CORRUPT_SNAPSHOT_INDEX');
    const raw=await storage.get(PREFIX+partIndex);
    if (raw == null || raw.length > FUTURE_SNAPSHOT_LIMITS.maxStorageValueChars) {
      throw Error('STALE_OR_MISSING_SNAPSHOT_PART');
    }
    let item;
    try { item=JSON.parse(raw); } catch { throw Error('CORRUPT_SNAPSHOT_PART'); }
    if(!item || item.g !== index.generation || !Array.isArray(item.rows) ||
       item.rows.length !== index.ranges[partIndex].count) {
      throw Error('STALE_OR_CORRUPT_SNAPSHOT_PART');
    }
    return item.rows[position-index.ranges[partIndex].start];
  }
  async function getPage({workId,language,cursor:pageCursor=null}) {
    checkWork(workId,language);
    let index;
    let start;
    if(pageCursor == null) {
      // First call fetches only already-bounded source evidence.
      // This does NOT implement the signed Host's large-HTTP acquisition.
      const rows=await fetchRows({workId,language});
      index=await persist(workId,language,rows);
      start=0;
    } else {
      const raw=await storage.get(KEY);
      if(raw==null) throw Error('STALE_OR_MISSING_SNAPSHOT_INDEX');
      index=parseIndex(raw);
      if(index.workId!==workId || index.language!==language) {
        throw Error('STALE_OR_FOREIGN_CHAPTER_CURSOR');
      }
      if(now()>index.expiresAt) throw Error('EXPIRED_CHAPTER_SNAPSHOT');
      start=validateCursor(pageCursor,index,workId,language);
    }
    const items=[];
    let position=start, next=null;
    while(position<index.count && items.length<FUTURE_SNAPSHOT_LIMITS.maxOutputRows) {
      const row=await readSlice(index,position);
      verifyRows([row],language);
      const trial=[...items,row], remaining=position+1<index.count;
      const trialCursor=remaining?cursor(workId,language,index.generation,position+1):null;
      const json=JSON.stringify({items:trial,nextCursor:trialCursor});
      if(json.length>FUTURE_SNAPSHOT_LIMITS.maxOutputBytes ||
          new TextEncoder().encode(json).length>FUTURE_SNAPSHOT_LIMITS.maxOutputBytes) {
        if (!items.length) throw Error('ROW_EXCEEDS_HOST_OUTPUT_BUDGET');
        break;
      }
      items.push(row);
      position++;
      next=trialCursor;
    }
    if(index.count>0&&!items.length) throw Error('NO_SNAPSHOT_CURSOR_PROGRESS');
    // Another invocation might have replaced the one-active-work snapshot.
    // Fail closed even if a concurrent write occurred while reading rows.
    const latest=await storage.get(KEY);
    if(latest == null || parseIndex(latest).generation!==index.generation) {
      throw Error('SNAPSHOT_REPLACED_DURING_READ');
    }
    if(position<index.count && next == null) {
      next=cursor(workId,language,index.generation,position);
    }
    return {items,nextCursor:next};
  }
  return {getPage};
}
