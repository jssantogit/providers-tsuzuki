// Future-only, NONSHIPPING lossless compact representation of the CURRENT
// MangaDot normalized chapter-list fields. Exact source HIDs have NO canonical
// identity authority. This does not grant storage or Reader permissions.
const ID=/^[1-9][0-9]{0,15}$/;
const NUM=/^[0-9]{1,6}(?:\.[0-9]{1,3})?$/;
const text=(v,max=1024)=>typeof v==='string'?v.trim().slice(0,max):'';
const id=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v)
  :typeof v==='string'&&ID.test(v)?v:null;
const number=v=>(typeof v==='number'||typeof v==='string')&&NUM.test(String(v))?
  Number(v):null;
const milliseconds=v=>{const n=typeof v==='string'?Date.parse(v):NaN;return Number.isFinite(n)&&n>=0?n:null;};
// Tuple order: raw numeric ID, number, upload=0/other=1, optional title,
// optional chapter language, optional scanlation group, optional date millis.
// Work HID and requested language belong to the snapshot header/cursor.
export function projectMangaDotSourceRow(row,requestedLanguage='en') {
  if(!['en','pt-br'].includes(requestedLanguage)) throw Error('INVALID_COMPACT_FACET');
  if(!row||typeof row!=='object'||Array.isArray(row)) return null;
  const local=id(row.id),n=number(row.chapter_number);
  if(!local||n===null) return null;
  const rawLang=row.language;
  if(rawLang!=null&&typeof rawLang!=='string') return null;
  const lang=rawLang==null?null:rawLang.toLowerCase();
  if(lang!=null&&lang!==requestedLanguage)return null;
  const title=text(row.chapter_title,3900)||null;
  const groups=Array.isArray(row.groups)?row.groups:[];
  const group=text(groups[0]?.name)||text(row.group_name)||
    text(row.scanlator_name)||null;
  return [local,n,row.source==null||row.source==='user'?0:1,
    title,lang,group,milliseconds(row.date_added)];
}
export function expandMangaDotSourceRow(tuple,requestedLanguage='en') {
  if(!Array.isArray(tuple)||tuple.length!==7||
      !['en','pt-br'].includes(requestedLanguage)) throw Error('INVALID_COMPACT_CHAPTER');
  const [local,n,foreign,title,lang,group,date]=tuple;
  if(typeof local!=='string'||!ID.test(local)||
      typeof n!=='number'||!Number.isFinite(n)||n<0||
      ![0,1].includes(foreign)||
      (title!==null&&(typeof title!=='string'||title.length>3900))||
      (lang!==null&&lang!==requestedLanguage)||
      (group!==null&&(typeof group!=='string'||group.length>1024))||
      (date!==null&&(!Number.isSafeInteger(date)||date<0))) {
    throw Error('INVALID_COMPACT_CHAPTER');
  }
  return {
    providerChapterId:'mangadot:'+(foreign?'chapters:':'uploads:')+local,
    rawLabel:'Ch. '+n+(title?' '+title:''),
    rawNumber:n,title,language:lang,
    scanlationGroup:group,releaseDateMillis:date,
  };
}
export function measureMangaDotCompactRow(row,language='en') {
  const packed=projectMangaDotSourceRow(row,language);
  if(packed===null)return null;
  const normalized=expandMangaDotSourceRow(packed,language);
  return {
    tupleChars:JSON.stringify(packed).length,
    normalizedChars:JSON.stringify(normalized).length,
  };
}

export function packNormalizedMangaDotChapter(row,requestedLanguage='en') {
  if(!row||typeof row!=='object'||Array.isArray(row)) {
    throw Error('LOSSY_COMPACT_CHAPTER');
  }
  const m=typeof row.providerChapterId==='string'?
    /^mangadot:(uploads|chapters):([1-9][0-9]{0,15})$/.exec(row.providerChapterId):null;
  if(!m||!['en','pt-br'].includes(requestedLanguage)) {
    throw Error('LOSSY_COMPACT_CHAPTER');
  }
  const tuple=[
    m[2],row.rawNumber,m[1]==='uploads'?0:1,row.title??null,
    row.language??null,row.scanlationGroup??null,row.releaseDateMillis??null,
  ];
  let restored;
  try { restored=expandMangaDotSourceRow(tuple,requestedLanguage); }
  catch { throw Error('LOSSY_COMPACT_CHAPTER'); }
  const keys=Object.keys(restored);
  if(Object.keys(row).length!==keys.length ||
      keys.some(key=>!Object.hasOwn(row,key)||!Object.is(row[key],restored[key]))) {
    throw Error('LOSSY_COMPACT_CHAPTER');
  }
  return tuple;
}
