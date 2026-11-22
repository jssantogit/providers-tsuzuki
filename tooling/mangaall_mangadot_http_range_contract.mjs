// Closed, source-independent HTTP Range metadata validator.
// A 206 is useful only when Content-Range exactly matches the requested
// inclusive byte interval and the decoded response has precisely that size.
// Never export headers or source body; call with fixed reviewed ranges only.
export function exactlyMatchesRequestedContentRange(value, start, end) {
  if (typeof value !== 'string' || value.length > 100 ||
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end < start || end - start + 1 > 65536) return false;
  const m = /^bytes ([0-9]{1,16})-([0-9]{1,16})\/([0-9]{1,16})$/.exec(value);
  if (!m) return false;
  const [from, to, total] = m.slice(1).map(Number);
  return Number.isSafeInteger(from) && Number.isSafeInteger(to) &&
    Number.isSafeInteger(total) && from === start && to === end && total > end;
}
export function exactlyMatchesRequestedContentLength(length, start, end) {
  return Number.isSafeInteger(length) && length === end - start + 1;
}
