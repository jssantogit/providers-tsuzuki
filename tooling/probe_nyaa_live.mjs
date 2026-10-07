import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLiveProbeHost } from "./nyaa_live_probe_support.mjs";

const providerModule = await import(
  pathToFileURL(path.resolve("providers/nyaa/main.js")).href
);
const provider = providerModule.default;

const scenarios = [
  { label: "one-piece-en", title: "One Piece", preferredLanguages: ["en"] },
  { label: "one-piece-all-literature", title: "One Piece", preferredLanguages: [] },
  { label: "chainsaw-man-en", title: "Chainsaw Man", preferredLanguages: ["en"] },
  { label: "chainsaw-man-all-literature", title: "Chainsaw Man", preferredLanguages: [] },
  { label: "spy-family-en", title: "Spy x Family", preferredLanguages: ["en"] },
  { label: "spy-family-all-literature", title: "Spy x Family", preferredLanguages: [] },
];

let successfulScenarios = 0;

for (const scenario of scenarios) {
  const diagnostics = [];
  const network = [];
  globalThis.tsuzuki = createLiveProbeHost({
    requestTimeoutMs: 5000,
    onDiagnostic: (entry) => diagnostics.push(entry),
    onNetwork: (entry) => network.push(entry),
  });

  const startedAtMillis = Date.now();
  try {
    const result = await provider.torrent.search({
      titles: [scenario.title],
      preferredLanguages: scenario.preferredLanguages,
      cursor: null,
    });
    successfulScenarios += 1;
    console.log(JSON.stringify({
      type: "nyaa_live_probe",
      label: scenario.label,
      preferredLanguages: scenario.preferredLanguages,
      resultCount: result.items.length,
      elapsedMs: Math.max(0, Date.now() - startedAtMillis),
      network,
      diagnostics,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      type: "nyaa_live_probe_failure",
      label: scenario.label,
      preferredLanguages: scenario.preferredLanguages,
      elapsedMs: Math.max(0, Date.now() - startedAtMillis),
      network,
      diagnostics,
      errorName: error?.name ?? "Error",
      errorMessage: String(error?.message ?? error),
    }));
  }
}

if (successfulScenarios === 0) {
  throw new Error("All Nyaa live probe scenarios failed before producing a Provider result");
}
