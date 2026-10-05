function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value) {
  const cleaned = cleanText(value);
  return cleaned || undefined;
}

function validSelectedPath(value) {
  const path = cleanText(value);
  if (!path || path.startsWith("/") || path.startsWith("\\") || path.includes("\\")) return false;
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return false;
  return /\.(?:cbz|zip)$/i.test(path);
}

function buildHostRequest(input) {
  const operationId = cleanText(input?.operationId);
  const torrent = input?.torrent ?? {};
  const file = input?.file ?? {};
  const selectedFileIndex = Number.isInteger(file.index) ? file.index : -1;
  const selectedFilePath = cleanText(file.path);
  const selectedFileSizeBytes = file.sizeBytes;

  if (!operationId) throw new Error("Direct P2P acquisition requires operationId");
  if (selectedFileIndex < 0) throw new Error("Direct P2P acquisition requires a valid selected file index");
  if (!validSelectedPath(selectedFilePath)) throw new Error("Direct P2P acquisition has invalid selected file path");
  if (selectedFileSizeBytes != null && (!Number.isSafeInteger(selectedFileSizeBytes) || selectedFileSizeBytes < 0)) {
    throw new Error("Direct P2P acquisition has invalid selected file size");
  }

  const infoHash = optionalText(torrent.infoHash)?.toLowerCase();
  const magnetUri = optionalText(torrent.magnetUri);
  const torrentUrl = optionalText(torrent.torrentUrl);
  if (!infoHash && !magnetUri && !torrentUrl) {
    throw new Error("Direct P2P acquisition requires torrent identity");
  }
  if (infoHash && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(infoHash)) {
    throw new Error("Direct P2P acquisition has invalid info hash");
  }

  const request = {
    operationId,
    selectedFileIndex,
    selectedFilePath,
  };
  if (magnetUri) request.magnetUri = magnetUri;
  if (torrentUrl) request.torrentUrl = torrentUrl;
  if (infoHash) request.infoHash = infoHash;
  if (selectedFileSizeBytes != null) request.selectedFileSizeBytes = selectedFileSizeBytes;
  return request;
}

async function p2p(input) {
  const acquire = globalThis.tsuzuki?.p2p?.acquire;
  if (typeof acquire !== "function") {
    throw new Error("Direct P2P Host Service is unavailable");
  }

  const responseJson = await acquire(JSON.stringify(buildHostRequest(input)));
  const response = JSON.parse(responseJson);

  if (response?.status === "ready") {
    const resource = cleanText(response.resource);
    const format = cleanText(response.format).toUpperCase();
    if (!resource || (format !== "CBZ" && format !== "ZIP")) {
      throw new Error("Direct P2P Host returned malformed ready result");
    }
    return { status: "ready", resource, format };
  }

  if (response?.status === "pending") {
    const jobId = cleanText(response.jobId);
    if (!jobId) throw new Error("Direct P2P Host returned malformed pending result");
    return { status: "pending", jobId };
  }

  if (response?.status === "failed") {
    const failure = cleanText(response.failure) || "UNAVAILABLE";
    throw new Error(`Direct P2P acquisition failed: ${failure}`);
  }

  throw new Error("Direct P2P Host returned unknown result");
}

export default {
  acquisition: {
    p2p,
  },
};
