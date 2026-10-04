import { signedApiUrl } from "./vrf.js";

export const BASE_URL = "https://mangafire.to";

function pairsFromObject(values) {
  const pairs = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) pairs.push([`${key}[]`, item]);
    } else {
      pairs.push([key, value]);
    }
  }
  return pairs;
}

function parseJsonBody(body) {
  const value = JSON.parse(body);
  if (value && typeof value === "object" && value.error === "captcha_required") {
    const error = new Error("MangaFire challenge required");
    error.challengeRequired = true;
    throw error;
  }
  return value;
}

async function browserJson(url) {
  if (!globalThis.tsuzuki?.browser?.readText) {
    throw new Error("MangaFire challenge requires the Browser Host Service");
  }
  const body = await globalThis.tsuzuki.browser.readText(url, "body");
  return parseJsonBody(body.trim());
}

export async function apiJson(path, params = {}) {
  const url = signedApiUrl(BASE_URL, path, pairsFromObject(params));
  const responseJson = await globalThis.tsuzuki.http.request(
    "GET",
    url,
    JSON.stringify({ Accept: "application/json" }),
  );
  const response = JSON.parse(responseJson);

  if (response.statusCode >= 200 && response.statusCode < 300) {
    try {
      return parseJsonBody(response.body);
    } catch (error) {
      if (!error.challengeRequired) throw error;
      return browserJson(url);
    }
  }

  if (response.statusCode === 403) {
    return browserJson(url);
  }

  throw new Error(`MangaFire API request failed with HTTP ${response.statusCode}`);
}

export async function searchTitles(title) {
  return apiJson("/api/titles", {
    keyword: title,
    page: 1,
    limit: 20,
  });
}

export async function chaptersForTitle(externalWorkId, language, page) {
  return apiJson(`/api/titles/${encodeURIComponent(externalWorkId)}/chapters`, {
    language,
    sort: "number",
    order: "desc",
    page,
    limit: 200,
  });
}

export async function pagesForChapter(providerChapterId) {
  return apiJson(`/api/chapters/${encodeURIComponent(providerChapterId)}`);
}
