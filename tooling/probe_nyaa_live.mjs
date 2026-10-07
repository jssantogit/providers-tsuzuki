import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLiveProbeHost } from "./nyaa_live_probe_support.mjs";

const providerModule = await import(
  pathToFileURL(path.resolve("providers/nyaa/main.js")).href
);
const provider = providerModule.default;

const smokeTitles = [
  ["boku-no-hero", "Boku no hero"],
  ["black-clover", "Black Clover"],
  ["one-piece", "One Piece"],
  ["tokyo-ghoul", "Tokyo Ghoul"],
];

const scenarios = smokeTitles.flatMap(([slug, title]) => [
  {
    label: `${slug}-title-only-real-host-shape`,
    titles: [title],
    preferredLanguages: [],
  },
  {
    label: `${slug}-chapter-1-real-host-shape`,
    titles: [title],
    preferredLanguages: [],
    chapterNumber: "1",
  },
]);

scenarios.push({
  label: "one-piece-missing-chapter-fallback-latency",
  titles: ["One Piece"],
  preferredLanguages: [],
  chapterNumber: "123456789",
});

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
      titles: scenario.titles,
      preferredLanguages: scenario.preferredLanguages,
      chapterNumber: scenario.chapterNumber,
      cursor: null,
    });
    successfulScenarios += 1;
    console.log(JSON.stringify({
      type: "nyaa_live_probe",
      label: scenario.label,
      titleCount: scenario.titles.length,
      hasChapterHint: Boolean(scenario.chapterNumber),
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
      titleCount: scenario.titles.length,
      hasChapterHint: Boolean(scenario.chapterNumber),
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
