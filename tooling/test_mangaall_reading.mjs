import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve("providers");
const manifestDex = JSON.parse(fs.readFileSync(path.join(root, "mangaall-dex", "manifest.json"), "utf8"));
assert.deepEqual(manifestDex.permissions.network.origins, [
  "https://api.mangadex.org",
  "https://uploads.mangadex.org",
  "https://*.mangadex.network",
], "image requests must have narrow explicit Host origin authority");
const modules = {};
for (const [id, dir, file] of [
  ["mangadex", "mangaall-dex", "mangadex"],
  ["mangaball", "mangaall-ball", "mangaball"],
  ["mangadot", "mangaall-dot", "mangadot"],
]) {
  modules[id] = await import(pathToFileURL(path.join(root, dir, "modules", file + ".js")).href);
  assert.equal(typeof modules[id].pages, "function", "source needs a Reader page adapter");
}
const requests = [];
let fixture;
globalThis.tsuzuki = {
  http: {
    async request(method, url, headersJson) {
      requests.push({ method, url, headers: JSON.parse(headersJson) });
      if (method === "POST" && new URL(url).origin === "https://mangaball.com") {
        assert.equal(JSON.parse(headersJson)["Content-Type"], "application/json");
      }
      // MangaDex chapter identity must be checked before fetching at-home
      // image metadata: a providerChapterId alone does not prove the work.
      if (new URL(url).pathname === "/chapter/" + chapterId) {
        return JSON.stringify({
          statusCode: 200,
          body: JSON.stringify({
            result: "ok",
            data: { id: chapterId, type: "chapter", attributes: chapterExternal ? {externalUrl:"https://publisher.example/chapter"} : {}, relationships: [
              { type: "manga", id: relatedMangaId },
            ] },
          }),
        });
      }
      return JSON.stringify(fixture({ method, url }));
    },
  },
};
const reply = (body) => ({ statusCode: 200, body: JSON.stringify(body) });
const mangaId = "11111111-2222-4333-8444-555555555555";
const chapterId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const hashes = "a".repeat(32);
let relatedMangaId = mangaId;
let chapterExternal = false;

fixture = () => reply({
  result: "ok", baseUrl: "https://uploads.mangadex.org",
  chapter: { hash: hashes, data: ["page-001.jpg", "page-002.png"], dataSaver: [] },
});
const dex = await modules.mangadex.pages({
  binding: { externalWorkId: "mangadex:" + mangaId },
  providerChapterId: "mangadex:" + chapterId,
});
assert.deepEqual(dex, {
  type: "page_list",
  pages: [
    { url: "https://uploads.mangadex.org/data/" + hashes + "/page-001.jpg", headers: {} },
    { url: "https://uploads.mangadex.org/data/" + hashes + "/page-002.png", headers: {} },
  ],
});
assert.equal(new URL(requests.at(-1).url).pathname, "/at-home/server/" + chapterId);
assert.equal(new URL(requests.at(-1).url).searchParams.get("forcePort443"), "true",
  "MangaDex@Home must select HTTPS port 443 to match Host's fixed-origin grants");
assert.equal(requests.some(({ url }) => new URL(url).pathname === "/chapter/" + chapterId), true);
relatedMangaId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
await assert.rejects(modules.mangadex.pages({
  binding: { externalWorkId: "mangadex:" + mangaId },
  providerChapterId: "mangadex:" + chapterId,
}), /work mismatch/i, "a chapter from another manga must never be exposed to this binding");
assert.equal(new URL(requests.at(-1).url).pathname, "/chapter/" + chapterId,
  "foreign chapter must be rejected before image URL resolution");
relatedMangaId = mangaId;
chapterExternal = true;
await assert.rejects(modules.mangadex.pages({
  binding: { externalWorkId: "mangadex:" + mangaId },
  providerChapterId: "mangadex:" + chapterId,
}), /external chapter/i, "MangaDex external releases are evidence but not internally readable");
assert.equal(new URL(requests.at(-1).url).pathname, "/chapter/" + chapterId,
  "never fetch MangaDex@Home for an external release");
chapterExternal = false;

const dynamicBase = "https://node.mangadex.network/temporary-token";
fixture = () => reply({
  result: "ok", baseUrl: dynamicBase,
  chapter: { hash: hashes, data: ["1.jpg"], dataSaver: [] },
});
const dynamic = await modules.mangadex.pages({
  binding: { externalWorkId: "mangadex:" + mangaId },
  providerChapterId: "mangadex:" + chapterId,
});
assert.equal(dynamic.pages[0].url, dynamicBase + "/data/" + hashes + "/1.jpg",
  "MangaDex@Home base URLs may contain port and token path");
for (const malicious of [
  "https://node.mangadex.network:12345/temporary-token",
  "http://node.mangadex.network/temporary-token",
  "https://node.mangadex.network.evil.test/temporary-token",
  "https://uploads.mangadex.org@evil.test",
  "https://node.mangadex.network:12345/../secrets",
  "https://node.mangadex.network:12345/%2e%2e/secrets",
]) {
  fixture = () => reply({
    result: "ok", baseUrl: malicious,
    chapter: { hash: hashes, data: ["1.jpg"], dataSaver: [] },
  });
  await assert.rejects(modules.mangadex.pages({
    binding: { externalWorkId: "mangadex:" + mangaId },
    providerChapterId: "mangadex:" + chapterId,
  }), /untrusted image origin/i, "MangaDex should reject " + malicious);
}

fixture = () => reply({
  result: "ok", baseUrl: "https://malicious.example",
  chapter: { hash: hashes, data: ["page-001.jpg"] },
});
await assert.rejects(modules.mangadex.pages({
  binding: { externalWorkId: "mangadex:" + mangaId },
  providerChapterId: "mangadex:" + chapterId,
}), /untrusted (image|page) origin/i);

fixture = () => reply({
  data: { chapter: { title_id: "416", pages: [
    "https://mangaball.com/static/page-1.jpg",
    "https://mangaball.com/static/page-2.png",
  ] } },
});
const ball = await modules.mangaball.pages({
  binding: { externalWorkId: "mangaball:416" },
  providerChapterId: "mangaball:9001",
});
assert.equal(new URL(requests.at(-1).url).pathname, "/api/v1/chapter-detail");
assert.equal(new URL(requests.at(-1).url).searchParams.get("chapter_id"), "9001");
assert.deepEqual(ball, {
  type: "page_list",
  pages: [
    { url: "https://mangaball.com/static/page-1.jpg", headers: { Referer: "https://mangaball.com/", Origin: "https://mangaball.com" } },
    { url: "https://mangaball.com/static/page-2.png", headers: { Referer: "https://mangaball.com/", Origin: "https://mangaball.com" } },
  ],
});
fixture = () => reply({ data: { chapter: {
  title_id: "416", pages: ["https://gengar.poke-black-and-white.net/storage/page-1.webp"],
} } });
const cdn = await modules.mangaball.pages({
  binding: { externalWorkId: "mangaball:416" }, providerChapterId: "mangaball:9001",
});
assert.deepEqual(cdn.pages, [{
  url: "https://gengar.poke-black-and-white.net/storage/page-1.webp",
  headers: { Referer: "https://mangaball.com/", Origin: "https://mangaball.com" },
}]);
fixture = () => reply({ data: { chapter: {
  title_id: "wrong-work", pages: ["https://mangaball.com/static/page-1.jpg"],
} } });
await assert.rejects(modules.mangaball.pages({
  binding: { externalWorkId: "mangaball:416" }, providerChapterId: "mangaball:9001",
}), /work mismatch/i);
// The public MangaBall chapter detail DTO permits missing title_id.
// In that case, verify membership in the work's own chapter listing instead
// of rejecting a legitimate reader or trusting a bare chapter ID.
fixture = ({ method }) => method === "POST"
  ? reply({ code: 200, data: [{ id: "9001", number: 1, lang: "en" }] })
  : reply({ data: { chapter: {
    pages: ["https://mangaball.com/static/page-1.jpg"],
  } } });
const beforeMembership = requests.length;
const verifiedByList = await modules.mangaball.pages({
  binding: { externalWorkId: "mangaball:416", facetId: "en" },
  providerChapterId: "mangaball:9001",
});
assert.equal(verifiedByList.pages.length, 1);
assert.equal(requests.length - beforeMembership, 2,
  "fallback checks the exact work listing before returning pages");
assert.equal(requests.at(-1).method, "POST");

fixture = ({ method }) => method === "POST"
  ? reply({ code: 200, data: [{ id: "9002", number: 1, lang: "en" }] })
  : reply({ data: { chapter: {
    pages: ["https://mangaball.com/static/page-1.jpg"],
  } } });
await assert.rejects(modules.mangaball.pages({
  binding: { externalWorkId: "mangaball:416", facetId: "en" },
  providerChapterId: "mangaball:9001",
}), /work mismatch/i, "a missing title_id without chapter-list membership is not trustworthy");
fixture = () => reply({ data: { chapter: { title_id: "416", pages: ["https://untrusted.example/img.jpg"] } } });
await assert.rejects(modules.mangaball.pages({
  binding: { externalWorkId: "mangaball:416" }, providerChapterId: "mangaball:9001",
}), /untrusted (image|page) origin/i);

fixture = () => reply({
  manga: { id: 317 },
  images: [{ url: "/pages/001.jpg" }, { url: "https://mangadot.net/pages/002.jpg" }],
});
const dot = await modules.mangadot.pages({
  binding: { externalWorkId: "mangadot:317" },
  providerChapterId: "mangadot:uploads:8001",
});
assert.equal(new URL(requests.at(-1).url).pathname, "/api/uploads/8001/images");
assert.deepEqual(dot, {
  type: "page_list",
  pages: [
    { url: "https://mangadot.net/pages/001.jpg", headers: { Referer: "https://mangadot.net/chapter/8001?source=user" } },
    { url: "https://mangadot.net/pages/002.jpg", headers: { Referer: "https://mangadot.net/chapter/8001?source=user" } },
  ],
});
fixture = () => reply({ manga: { id: 317 }, images: [{ url: "//untrusted.example/x.jpg" }] });
await assert.rejects(modules.mangadot.pages({
  binding: { externalWorkId: "mangadot:317" }, providerChapterId: "mangadot:uploads:8001",
}), /untrusted (image|page) origin/i);
fixture = () => reply({ manga: { id: 999 }, images: [{ url: "/pages/1.jpg" }] });
await assert.rejects(modules.mangadot.pages({
  binding: { externalWorkId: "mangadot:317" }, providerChapterId: "mangadot:uploads:8001",
}), /work mismatch/i);
await assert.rejects(modules.mangadot.pages({
  binding: { externalWorkId: "mangadot:317" }, providerChapterId: "mangadot:other:8001",
}), /invalid chapter id/i);
console.log("MangaAll three-source Reader metadata, identity and origin guards: OK");
