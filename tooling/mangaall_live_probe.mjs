// Explicit, low-volume upstream preflight. NOT a Reader or Android smoke.
// Use: node tooling/mangaall_live_probe.mjs --live
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHttpBridge, inspectSource } from "./mangaall_live_probe_core.mjs";

if (process.argv.length !== 3 || process.argv[2] !== "--live") {
  console.error("Explicit opt-in required: node tooling/mangaall_live_probe.mjs --live");
  process.exit(2);
}
const title = "Haikyuu!!";
const configs = [
  ["mangadex", "mangaall-dex", "mangadex"],
  ["mangaball", "mangaall-ball", "mangaball"],
  ["mangadot", "mangaall-dot", "mangadot"],
];
for (const [sourceId, folder, moduleName] of configs) {
  const root = path.resolve("providers", folder);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const origins = manifest.permissions?.network?.origins;
  // The probe is API-only; it never downloads or follows image URLs.
  // MangaDex's reviewed image origins are grants for the future Reader,
  // not additional API hosts the preflight may contact.
  const expectedOrigins = sourceId === "mangadex"
    ? ["https://api.mangadex.org", "https://uploads.mangadex.org", "https://*.mangadex.network"]
    : sourceId === "mangaball" ? ["https://mangaball.com"] : ["https://mangadot.net"];
  if (!Array.isArray(origins) ||
      JSON.stringify(origins) !== JSON.stringify(expectedOrigins) ||
      manifest.publication !== "development") {
    throw Error("MangaAll probe requires one isolated development source origin");
  }
  const bridge = createHttpBridge({ origin: origins[0] });
  globalThis.tsuzuki = { http: bridge };
  const adapter = await import(pathToFileURL(path.join(root, "modules", moduleName + ".js")).href);
  const result = await inspectSource({
    sourceId, title, language: "en", providerId: manifest.id,
    allowedOrigins: origins, adapter,
  });
  console.log(JSON.stringify({ ...result, requestCount: bridge.requestCount }));
}
console.error("Preflight only: no page bytes downloaded, no ICE/Reader/Android validation.");
