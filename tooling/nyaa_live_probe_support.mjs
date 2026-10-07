const NYAA_ORIGIN = "https://nyaa.si";
const DETAIL_PLACEHOLDER = "<!doctype html><html><body><!-- live-probe-skip-detail --></body></html>";

function parseHeaders(headersJson) {
  if (typeof headersJson !== "string" || headersJson.length === 0) return {};
  const parsed = JSON.parse(headersJson);
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Live probe headers must decode to an object");
  }
  return parsed;
}

export function createLiveProbeHost({
  fetchImpl = globalThis.fetch,
  onDiagnostic = () => {},
  onNetwork = () => {},
  requestTimeoutMs = 5000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Live probe requires fetch");
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("Live probe timeout must be positive");
  }

  return {
    http: {
      async request(method, url, headersJson) {
        const parsedUrl = new URL(url);
        if (parsedUrl.origin !== NYAA_ORIGIN) {
          throw new Error("Live probe refused a non-Nyaa request");
        }

        if (parsedUrl.pathname.startsWith("/view/")) {
          return JSON.stringify({ statusCode: 200, body: DETAIL_PLACEHOLDER });
        }

        const startedAtMillis = Date.now();
        const response = await fetchImpl(url, {
          method,
          headers: parseHeaders(headersJson),
          redirect: "follow",
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        const body = await response.text();
        await onNetwork({
          page: parsedUrl.searchParams.get("page"),
          category: parsedUrl.searchParams.get("c"),
          filter: parsedUrl.searchParams.get("f"),
          queryLength: (parsedUrl.searchParams.get("q") ?? "").length,
          statusCode: response.status,
          bodyLength: body.length,
          elapsedMs: Math.max(0, Date.now() - startedAtMillis),
        });
        return JSON.stringify({ statusCode: response.status, body });
      },
    },
    log: {
      async info(message) {
        const parsed = JSON.parse(String(message));
        await onDiagnostic(parsed);
      },
    },
  };
}
