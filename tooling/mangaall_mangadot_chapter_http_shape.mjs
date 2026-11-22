// Bounded test-only shape summary of MangaDot chapter-list HTTP replies.
// No raw body, chapter IDs, titles, URLs, cookies or source messages escape.
const fields = ['chapters', 'chapter_list', 'data', 'items', 'results', 'list'];
const sanitizeCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 16000 ? value : null;
export function describeMangaDotChapterListHttp(rawEnvelope) {
  const result = {
    status: null, bodyKind: 'UNDETERMINED', collection: 'NONE', count: null,
    firstRowKind: 'NONE', idKind: 'NONE', numberKind: 'NONE',
    hasErrorField: false,
  };
  if (typeof rawEnvelope !== 'string' || rawEnvelope.length > 4 * 1024 * 1024) {
    result.bodyKind = 'INVALID_ENVELOPE'; return result;
  }
  let envelope;
  try { envelope = JSON.parse(rawEnvelope); } catch { result.bodyKind = 'INVALID_ENVELOPE'; return result; }
  if (Number.isInteger(envelope?.statusCode) && envelope.statusCode >= 100 &&
      envelope.statusCode <= 599) result.status = envelope.statusCode;
  if (typeof envelope?.body !== 'string') { result.bodyKind = 'MISSING_BODY'; return result; }
  let body;
  try { body = JSON.parse(envelope.body); } catch {
    result.bodyKind = /^s*</.test(envelope.body) ? 'NON_JSON_MARKUP' : 'NON_JSON_OTHER';
    return result;
  }
  const type = body === null ? 'NULL' :
    Array.isArray(body) ? 'ARRAY' : typeof body === 'object' ? 'OBJECT' :
      typeof body === 'string' ? 'STRING' : typeof body === 'number' ? 'NUMBER' : 'BOOLEAN';
  result.bodyKind = type;
  if (type === 'OBJECT') {
    result.hasErrorField = Object.hasOwn(body, 'error') || Object.hasOwn(body, 'errors');
  }
  const arr = type === 'ARRAY' ? body :
    type === 'OBJECT' ? fields.map(f => [f, body[f]]).find(([_,v]) => Array.isArray(v)) : null;
  if (!arr) return result;
  const list = Array.isArray(arr) ? (type === 'ARRAY' ? arr : arr[1]) : null;
  result.collection = type === 'ARRAY' ? 'ROOT' : arr[0];
  result.count = sanitizeCount(list?.length);
  const first = list?.[0];
  result.firstRowKind = first == null ? 'NONE' : Array.isArray(first) ? 'ARRAY' : typeof first === 'object' ? 'OBJECT' : 'SCALAR';
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    result.idKind = first.id == null ? 'NONE' : typeof first.id === 'string' ? 'STRING' : typeof first.id === 'number' ? 'NUMBER' : 'OTHER';
    result.numberKind = first.chapter_number == null ? 'NONE' : typeof first.chapter_number === 'string' ? 'STRING' : typeof first.chapter_number === 'number' ? 'NUMBER' : 'OTHER';
  }
  return result;
}

export function describeMangaDotChapterTransportFailure(error) {
  // Full error messages may include upstream data. Only exact local bridge
  // errors are mapped. An arbitrary source error is an opaque OTHER.
  const reason = error?.message === 'MangaAll response too large'
    ? 'BRIDGE_RESPONSE_TOO_LARGE'
    : error?.message === 'MangaAll request limit' ? 'BRIDGE_REQUEST_LIMIT'
      : 'TRANSPORT_OR_RUNTIME_FAILURE';
  return {
    status: null, bodyKind: reason, collection: 'NONE', count: null,
    firstRowKind: 'NONE', idKind: 'NONE', numberKind: 'NONE',
    hasErrorField: false,
  };
}
