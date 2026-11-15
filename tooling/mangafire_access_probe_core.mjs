// MangaFire public-access classifier. Transport-only, no browser identity,
// cookies, challenge solving, page bytes, candidate records, or source decisions.
// This is NOT the Android Browser Host Service and cannot prove Reader access.
import { signedApiUrl } from '../providers/mangaall/modules/sources/mangafire/modules/vrf.js';

const ORIGIN = 'https://mangafire.to';
const PUBLIC_QUERY = 'Oyasumi Punpun'; // Never written into the result/report.

function mimeCategory(value) {
  if (typeof value !== 'string') return 'UNKNOWN';
  const type = value.split(';')[0].toLowerCase().trim();
  if (type === 'application/json' || type.endsWith('+json')) return 'JSON';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'HTML';
  return 'OTHER';
}
async function inspect(fetchImpl, url, accept) {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: accept },
      redirect: 'manual', // Redirects are not followed across origins.
      credentials: 'omit',
      signal: AbortSignal.timeout(10_000),
    });
    const status = Number.isInteger(response?.status) && response.status >= 100 &&
      response.status <= 599 ? response.status : null;
    const challenge = response?.headers?.get('cf-mitigated')?.toLowerCase() === 'challenge';
    const contentType = mimeCategory(response?.headers?.get('content-type'));
    // The comparison deliberately does not consume response text. It cannot
    // accidentally log HTML challenges, tokens or user-provided content.
    await response?.body?.cancel?.().catch?.(() => {});
    return { status, contentType, challenge };
  } catch {
    return { status: null, contentType: 'UNKNOWN', challenge: false };
  }
}
export function classifyMangaFireAccess(homepage, api) {
  if (homepage.challenge || api.challenge) return 'UPSTREAM_CHALLENGE';
  if (homepage.status == null || api.status == null) return 'TRANSPORT_UNAVAILABLE';
  if (homepage.status === 403 && api.status === 403) return 'SITE_AND_API_DENIED';
  if (api.status === 403) return homepage.status >= 200 && homepage.status < 300
    ? 'API_ONLY_DENIED' : 'API_DENIED_SITE_UNRESOLVED';
  if (homepage.status >= 500 || api.status >= 500) return 'UPSTREAM_UNAVAILABLE';
  if (api.status >= 200 && api.status < 300 && api.contentType === 'JSON') {
    return homepage.status >= 200 && homepage.status < 300
      ? 'SIGNED_API_HTTP_AVAILABLE' : 'API_HTTP_AVAILABLE_SITE_UNRESOLVED';
  }
  return 'INCONCLUSIVE_HTTP';
}
export async function diagnoseMangaFireAccess({ fetchImpl = fetch } = {}) {
  const apiUrl = signedApiUrl(ORIGIN, '/api/titles', [
    ['keyword', PUBLIC_QUERY], ['page', 1], ['limit', 20],
  ]);
  const homepage = await inspect(fetchImpl, ORIGIN + '/', 'text/html');
  const api = await inspect(fetchImpl, apiUrl, 'application/json');
  return {
    diagnosticVersion: 1,
    source: 'MANGAFIRE',
    scope: 'CI_PLAIN_HTTP_ONLY_NO_BROWSER_SESSION',
    homepage, api,
    classification: classifyMangaFireAccess(homepage, api),
    browserSessionTested: false,
    signerReference: 'PRODUCTION_MANGAALL_CODE7',
  };
}
