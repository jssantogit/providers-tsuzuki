import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLiveProbeHost } from "./nyaa_live_probe_support.mjs";

const providerModule = await import(
  pathToFileURL(path.resolve("providers/nyaa/main.js")).href
);
const provider = providerModule.default;

const scenarios = [
  { label: "one-piece-title-only-en", titles: ["One Piece"], preferredLanguages: ["en"] },
  { label: "one-piece-title-only-all", titles: ["One Piece"], preferredLanguages: [] },
  { label: "one-piece-chapter-1", titles: ["One Piece"], preferredLanguages: ["en"], chapterNumber: "1" },
  {
    label: "one-piece-japanese-primary-english-alias-chapter-1",
    titles: ["ワンピース", "One Piece"],
    preferredLanguages: ["en"],
    chapterNumber: "1",
  },
  { label: "chainsaw-man-chapter-1", titles: ["Chainsaw Man"], preferredLanguages: ["en"], chapterNumber: "1" },
  {
    label: "chainsaw-man-japanese-primary-english-alias-chapter-1",
    titles: ["チェンソーマン", "Chainsaw Man"],
    preferredLanguages: ["en"],
    chapterNumber: "1",
  },
  { label: "spy-family-chapter-1", titles: ["Spy x Family"], preferredLanguages: ["en"], chapterNumber: "1" },
  {
    label: "spy-family-stylized-primary-english-alias-chapter-1",
    titles: ["SPY×FAMILY", "Spy x Family"],
    preferredLanguages: ["en"],
    chapterNumber: "1",
  },
  {
    label: "synthetic-primary-fallback-latency",
    titles: ["One Piece"],
    preferredLanguages: ["en"],
    chapterNumber: "123456789",
  },
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
