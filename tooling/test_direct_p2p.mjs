import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("providers/direct-p2p");
const calls = [];
let hostResponse = {
  status: "ready",
  resource: "managed:test",
  format: "CBZ",
};

globalThis.tsuzuki = {
  p2p: {
    async acquire(requestJson) {
      const request = JSON.parse(requestJson);
      calls.push(request);
      return JSON.stringify(hostResponse);
    },
  },
};

const providerModule = await import(pathToFileURL(path.join(root, "main.js")).href);
const provider = providerModule.default;
assert.equal(typeof provider?.acquisition?.p2p, "function", "missing acquisition.p2p");

const input = {
  operationId: "reader:public-domain-test:1",
  torrent: {
    infoHash: "0123456789abcdef0123456789abcdef01234567",
    magnetUri: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
    torrentUrl: "https://nyaa.si/download/1234567.torrent",
  },
  file: {
    index: 0,
    path: "Public Domain Test Chapter 1.cbz",
    sizeBytes: 12 * 1024 * 1024,
    languages: ["en"],
  },
};

const ready = await provider.acquisition.p2p(input);
assert.deepEqual(ready, {
  status: "ready",
  resource: "managed:test",
  format: "CBZ",
});
assert.deepEqual(calls[0], {
  operationId: input.operationId,
  magnetUri: input.torrent.magnetUri,
  torrentUrl: input.torrent.torrentUrl,
  infoHash: input.torrent.infoHash,
  selectedFileIndex: input.file.index,
  selectedFilePath: input.file.path,
  selectedFileSizeBytes: input.file.sizeBytes,
});

hostResponse = { status: "pending", jobId: "p2p:test-job" };
const pending = await provider.acquisition.p2p(input);
assert.deepEqual(pending, { status: "pending", jobId: "p2p:test-job" });

hostResponse = { status: "failed", failure: "FILE_MISMATCH" };
await assert.rejects(
  () => provider.acquisition.p2p(input),
  /Direct P2P acquisition failed: FILE_MISMATCH/,
);

await assert.rejects(
  () => provider.acquisition.p2p({ ...input, file: { ...input.file, path: "../escape.cbz" } }),
  /invalid selected file path/i,
);

console.log("Direct P2P Provider acquisition.p2p fixtures: OK");
