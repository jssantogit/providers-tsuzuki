// Opt-in diagnostic probe for issue #176. No persistent cookies, secrets or
// response bodies are logged. The source is contacted only from this workflow.
import { signedApiUrl } from "../providers/mangafire/modules/vrf.js";

const CASES = [
  ["vagabond-normal", "4mx"],
  ["vagabond-colored", "qnlvj"],
  ["spy-family-control", "yqxmj"],
];
const ORDERS = ["asc", "desc"];
const MAX_BODY_BYTES = 192 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;

for (const [label, hid] of CASES) {
  for (const order of ORDERS) {
    const params = [
      ["language", "en"], ["sort", "number"], ["order", order],
      ["page", 1], ["limit", 200],
    ];
    const url = signedApiUrl("https://mangafire.to", `/api/titles/${hid}/chapters`, params);
    const started = performance.now();
    let result = { case: label, order };
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "error",
      });
      const length = Number(response.headers.get("content-length") ?? 0);
      result = {
        ...result,
        status: response.status,
        contentType: (response.headers.get("content-type") ?? "").split(";")[0],
        contentLength: Number.isFinite(length) ? length : null,
      };
      if (length > MAX_BODY_BYTES) {
        result.outcome = "BODY_TOO_LARGE";
      } else {
        const buffer = await response.arrayBuffer();
        result.bodyBytes = buffer.byteLength;
        if (buffer.byteLength > MAX_BODY_BYTES) {
          result.outcome = "BODY_TOO_LARGE";
        } else if (response.ok) {
          try {
            const decoded = JSON.parse(new TextDecoder().decode(buffer));
            result.itemCount = Array.isArray(decoded.items) ? decoded.items.length : null;
            result.hasNext = typeof decoded?.meta?.hasNext === "boolean" ? decoded.meta.hasNext : null;
            result.lastPage = Number.isInteger(decoded?.meta?.lastPage) ? decoded.meta.lastPage : null;
            result.outcome = Array.isArray(decoded.items) ? "VALID_ITEMS" : "INVALID_ITEMS";
          } catch {
            result.outcome = "NON_JSON";
          }
        } else {
          result.outcome = "HTTP_ERROR";
        }
      }
    } catch (error) {
      // No source response bodies, URLs, cookies, auth or VRF query strings.
      result.outcome = error?.name === "TimeoutError" ? "TIMEOUT" :
        error?.name === "AbortError" ? "ABORTED" : "TRANSPORT_ERROR";
      result.errorType = error?.name ?? "Error";
    }
    result.elapsedMs = Math.round(performance.now() - started);
    console.log(JSON.stringify(result));
  }
}
