// EXPERIMENTAL, NONSHIPPING: bounded incremental parser for a trusted JSON
// *array* of source chapter metadata. Never a source of canonical authority.
// Unlike JSON.parse(wholeBody), this holds only a single bounded row plus
// bounded numeric ID deduplication state. Failures never mean "empty source".
const DEFAULTS = Object.freeze({
  maxDecodedBytes: 16 * 1024 * 1024,
  maxRows: 16000,
  maxRowChars: 20000,
});
const isWhitespace = char => char === ' ' || char === '\n' || char === '\r' || char === '\t';
export function closedSourceFailure(error) {
  const code = error?.message;
  return [
    'INVALID_JSON_ARRAY_STREAM', 'SOURCE_STREAM_TOO_LARGE',
    'SOURCE_ROW_TOO_LARGE', 'SOURCE_TOO_MANY_ROWS',
    'INVALID_SOURCE_ROW', 'INCOMPLETE_JSON_ARRAY_STREAM',
  ].includes(code) ? code : 'SOURCE_TRANSPORT_OR_RUNTIME_FAILED';
}
export async function inspectBoundedChapterArray(chunks, config = {}) {
  const {maxDecodedBytes,maxRows,maxRowChars} = {...DEFAULTS,...config};
  if (![maxDecodedBytes,maxRows,maxRowChars].every(x=>Number.isSafeInteger(x)&&x>0) ||
      maxDecodedBytes>16*1024*1024 || maxRows>16000 || maxRowChars>20000) {
    throw Error('INVALID_JSON_ARRAY_STREAM');
  }
  const decoder = new TextDecoder('utf-8',{fatal:true});
  let state = 'START', insideString = false, escapeNext = false, depth = 0;
  let current = '', decodedBytes = 0, count = 0, validIds = 0, duplicatedIds = 0;
  let numericChapters = 0, maxObservedRowChars = 0, userSources = 0, otherSources = 0;
  const ids = new Set();
  function consumeRow() {
    let row;
    try { row = JSON.parse(current); } catch { throw Error('INVALID_JSON_ARRAY_STREAM'); }
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw Error('INVALID_SOURCE_ROW');
    }
    count++;
    if (count>maxRows) throw Error('SOURCE_TOO_MANY_ROWS');
    maxObservedRowChars = Math.max(maxObservedRowChars,current.length);
    // Values are used only internally for type/count classification. Never
    // exported, logged or returned from this function.
    const id = row.id;
    if ((typeof id === 'number' && Number.isSafeInteger(id) && id>0) ||
        (typeof id === 'string' && /^[1-9][0-9]{0,15}$/.test(id))) {
      const key = String(id);
      if (ids.has(key)) duplicatedIds++;
      else {ids.add(key);validIds++;}
    }
    const nr = row.chapter_number;
    if ((typeof nr === 'number' && Number.isFinite(nr) && nr>=0) ||
        (typeof nr === 'string' && /^[0-9]{1,6}(?:\.[0-9]{1,3})?$/.test(nr))) {
      numericChapters++;
    }
    if (row.source === 'user' || row.source == null) userSources++;
    else otherSources++;
    current = '';
  }
  function consume(text) {
    for(const char of text) {
      if(state === 'DONE') {
        if(!isWhitespace(char)) throw Error('INVALID_JSON_ARRAY_STREAM');
      } else if(state === 'START') {
        if(char === '[') state='FIRST';
        else if(!isWhitespace(char)) throw Error('INVALID_JSON_ARRAY_STREAM');
      } else if(state === 'FIRST' || state === 'NEXT') {
        if(isWhitespace(char)) continue;
        if(char === ']' && state === 'FIRST') {state='DONE';continue;}
        if(char !== '{') throw Error('INVALID_JSON_ARRAY_STREAM');
        state='ROW';depth=1;insideString=false;escapeNext=false;current='{';
      } else if(state === 'AFTER_ROW') {
        if(char === ',') state='NEXT';
        else if(char === ']') state='DONE';
        else if(!isWhitespace(char)) throw Error('INVALID_JSON_ARRAY_STREAM');
      } else if(state === 'ROW') {
        current += char;
        if(current.length > maxRowChars) throw Error('SOURCE_ROW_TOO_LARGE');
        if(insideString) {
          if(escapeNext) escapeNext=false;
          else if(char === '\\') escapeNext=true;
          else if(char === '"') insideString=false;
        } else if(char === '"') insideString=true;
        else if(char === '{' || char === '[') depth++;
        else if(char === '}' || char === ']') {
          depth--;
          if(depth<0) throw Error('INVALID_JSON_ARRAY_STREAM');
          if(depth===0) {consumeRow();state='AFTER_ROW';}
        }
      }
    }
  }
  try {
    for await(const part of chunks) {
      if(!(part instanceof Uint8Array)) throw Error('INVALID_JSON_ARRAY_STREAM');
      decodedBytes+=part.byteLength;
      if(decodedBytes>maxDecodedBytes) throw Error('SOURCE_STREAM_TOO_LARGE');
      consume(decoder.decode(part,{stream:true}));
    }
    consume(decoder.decode());
  } catch(error) {
    if(closedSourceFailure(error) === 'SOURCE_TRANSPORT_OR_RUNTIME_FAILED') {
      throw Error('INCOMPLETE_JSON_ARRAY_STREAM');
    }
    throw error;
  }
  if(state !== 'DONE') throw Error('INCOMPLETE_JSON_ARRAY_STREAM');
  return {
    outcome:'COMPLETE_SOURCE_ARRAY_OBSERVED_METADATA_ONLY',rowCount:count,
    distinctNumericIds:validIds,duplicateNumericIds:duplicatedIds,
    numericChapterLabels:numericChapters,maxRowChars:maxObservedRowChars,
    userOrUnknownSourceRows:userSources,otherSourceRows:otherSources,
    decodedBytes,authority:'UNVERIFIED_SOURCE_HID_NO_CANONICAL_OR_READER',
  };
}
