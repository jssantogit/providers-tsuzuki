/*
 * Portions adapted from the MangaFire extension in keiyoushi/extensions-source
 * (Apache-2.0), substantially modified for the Tsuzuki Provider Platform.
 * See assets/THIRD_PARTY_NOTICES.txt.
 */

const STAGE_DATA = [
  {
    tableB64: "yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==",
    keyB64: "0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=",
    iv: 0x5a,
  },
  {
    tableB64: "IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==",
    keyB64: "AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==",
    iv: 0x35,
  },
  {
    tableB64: "NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ==",
    keyB64: "DELOJgPsVaCcblDtTGMdHzM=",
    iv: 0xba,
  },
];

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(value) {
  const clean = value.replace(/\s+/g, "").replace(/=+$/, "");
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const index = BASE64.indexOf(clean[i]);
    if (index < 0) throw new Error("Invalid base64 data");
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return bytes;
}

function encodeBase64Url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64[(triple >> 18) & 63];
    out += BASE64[(triple >> 12) & 63];
    if (i + 1 < bytes.length) out += BASE64[(triple >> 6) & 63];
    if (i + 2 < bytes.length) out += BASE64[triple & 63];
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_");
}

function utf8Bytes(value) {
  const encoded = encodeURIComponent(value);
  const bytes = [];
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] === "%") {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  return bytes;
}

const STAGES = STAGE_DATA.map((stage) => ({
  table: decodeBase64(stage.tableB64),
  key: decodeBase64(stage.keyB64),
  iv: stage.iv,
}));

export function signCanonicalPath(path) {
  let data = utf8Bytes(path);
  for (const stage of STAGES) {
    const output = new Array(data.length);
    let previous = stage.iv;
    for (let i = 0; i < data.length; i += 1) {
      previous = stage.table[(data[i] ^ stage.key[i % stage.key.length] ^ previous) & 0xff];
      output[i] = previous;
    }
    data = output;
  }
  return encodeBase64Url(data);
}

function encodeQueryComponent(value) {
  return encodeURIComponent(String(value));
}

export function signedApiUrl(baseUrl, apiPath, pairs) {
  const normalizedPath = apiPath.startsWith("/api/") ? apiPath : `/api/${apiPath.replace(/^\/+/, "")}`;
  const sorted = pairs
    .map(([key, value], index) => ({ key: String(key), value: String(value), index }))
    .sort((left, right) => left.key.localeCompare(right.key) || left.index - right.index);

  let repeatedKey = null;
  let repeatedIndex = 0;
  const canonicalQuery = sorted.map(({ key, value }) => {
    let canonicalKey = key;
    if (key.endsWith("[]")) {
      if (repeatedKey !== key) repeatedIndex = 0;
      repeatedKey = key;
      canonicalKey = key.slice(0, -2) + `[${repeatedIndex}]`;
      repeatedIndex += 1;
    }
    return `${canonicalKey}=${value}`;
  });

  const canonicalPath = normalizedPath.slice(4) + (canonicalQuery.length ? `?${canonicalQuery.join("&")}` : "");
  const requestQuery = sorted.map(({ key, value }) => `${encodeQueryComponent(key)}=${encodeQueryComponent(value)}`);
  requestQuery.push(`vrf=${encodeQueryComponent(signCanonicalPath(canonicalPath))}`);
  return `${baseUrl}${normalizedPath}?${requestQuery.join("&")}`;
}
