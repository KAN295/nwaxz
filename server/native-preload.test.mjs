import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DOWNLOAD_IDLE_MS, fetchVerifiedAsset } from "../src/native-preload.ts";
import { assetTransferURL } from "../src/preload-policy.ts";

const bytes = Buffer.from(Array.from({ length: 700003 }, (_, i) => i % 251));
const integrity = "sha256-" + createHash("sha256").update(bytes).digest("base64");
const url = "https://example.invalid/assets/test.png";
const headers = { "content-type": "image/png", "cache-control": "no-cache, no-transform" };
const whole = body => new Response(body, { headers });
const partial = (body, start, end) => new Response(body, {
  status: 206,
  headers: { ...headers, "content-range": `bytes ${start}-${end}/${bytes.length}` },
});
const download = (fetcher, onProgress = () => {}) =>
  fetchVerifiedAsset(url, bytes.length, integrity, onProgress, { fetcher, resumable: true, painting: true });

test("healthy connections download a complete byte-identical PNG in one request", async () => {
  let requests = 0;
  const response = await download(async (requested, options) => {
    requests++;
    assert.equal(requested, url);
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "default");
    assert.equal(options.headers, undefined);
    return whole(bytes);
  });
  assert.equal(requests, 1);
  assert.equal(response.headers.get("content-range"), null);
  assert.equal(response.headers.get("content-length"), String(bytes.length));
  assert.match(response.headers.get("cache-control"), /no-transform/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test("an interrupted native download resumes exactly at the last received byte", async () => {
  const ranges = [], progress = [];
  const split = 310000;
  const response = await download(async (_url, options) => {
    ranges.push(options.headers?.Range);
    if (ranges.length === 1) return whole(bytes.subarray(0, split));
    return partial(bytes.subarray(split), split, bytes.length - 1);
  }, received => progress.push(received));
  assert.deepEqual(ranges, [undefined, `bytes=${split}-${bytes.length - 1}`]);
  assert.deepEqual(progress, [split, bytes.length]);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test("a slow download stays alive as long as bytes are flowing", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const progress = [];
  const response = await download(async (_url, options) => {
    const body = new ReadableStream({
      async pull(stream) {
        if (!progress.length) {
          t.mock.timers.tick(DOWNLOAD_IDLE_MS - 5000);
          stream.enqueue(bytes.subarray(0, 1000));
        } else {
          t.mock.timers.tick(DOWNLOAD_IDLE_MS - 5000);
          assert.equal(options.signal.aborted, false);
          stream.enqueue(bytes.subarray(1000));
          stream.close();
        }
      },
    }, { highWaterMark: 0 });
    return whole(body);
  }, n => progress.push(n));
  assert.deepEqual(progress, [1000, bytes.length]);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test("invalid ranges, truncated data, the wrong MIME and corrupted bytes cannot be cached", async () => {
  const invalid = [
    () => partial(bytes.subarray(1), 1, bytes.length - 1),
    () => whole(bytes.subarray(0, 100)),
    () => new Response("error", { headers: { "content-type": "text/html" } }),
    () => whole(Buffer.alloc(bytes.length)),
  ];
  for (const fetcher of invalid) await assert.rejects(() => download(fetcher));
});

test("invalid manifests are rejected without fetching", async () => {
  for (const [size, digest] of [[0, integrity], [9 * 1024 * 1024, integrity], [bytes.length, "invalid"]]) {
    await assert.rejects(() => fetchVerifiedAsset(url, size, digest, () => {}, {
      fetcher: async () => assert.fail("invalid manifest reached network"),
    }), /清单/);
  }
});

test("only revisioned public binary assets get a CDN cache key", () => {
  const revision = "bead".repeat(8);
  assert.equal(assetTransferURL(url, revision), `${url}?nwaxz_v=${revision}`);
  for (const path of ["/assets/test.png", "/assets/test.glb", "/assets/test.mp4"]) {
    assert.notEqual(assetTransferURL(`https://example.invalid${path}`, revision), `https://example.invalid${path}`);
  }
  for (const path of ["/sw.js", "/game-worker", "/index.html", "/preload-manifest.json", "/api/example.png"]) {
    const original = `https://example.invalid${path}`;
    assert.equal(assetTransferURL(original, revision), original);
  }
  assert.equal(assetTransferURL(url, null), url);
});
