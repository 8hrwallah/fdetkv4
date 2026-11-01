import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { before, after } from "node:test";
import { promisify } from "node:util";

// Real libcurl.js + real wisp-js + a local raw-TCP upstream (see tests/support). Plain HTTP on
// loopback: this proves transport behaviour, not TLS, CDN or TikTok playback.
const run = promisify(execFile);
const harness = path.join(import.meta.dirname, "support/libcurl-transport-harness.mjs");
let dir;
let r;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "libcurl-transport-"));
  const out = path.join(dir, "results.json");
  await run(process.execPath, [harness, out], { timeout: 100_000, maxBuffer: 16 * 1024 * 1024 });
  r = JSON.parse(await readFile(out, "utf8"));
  assert.equal(r.harnessError, undefined);
});
after(() => rm(dir, { recursive: true, force: true }));

const clean = { loopRunning: false, active: 0, callbacks: 0, inFlight: 0 };
const pick = (value, keys) => Object.fromEntries(keys.map((k) => [k, value[k]]));

test("upstream status codes, headers and bodies pass through unchanged, including errors and redirects", () => {
  assert.deepEqual(pick(r["/ok"], ["status", "ended", "bytes", "text"]), { status: 200, ended: "clean", bytes: 5, text: "hello" });
  assert.deepEqual(pick(r["/status403"], ["status", "ended", "bytes", "text"]), { status: 403, ended: "clean", bytes: 9, text: "forbidden" });
  assert.deepEqual(pick(r["/status500"], ["status", "ended", "text"]), { status: 500, ended: "clean", text: "oops" });
  assert.equal(r["/missing"].status, 404);
  assert.equal(r["/redirect"].status, 302);
  assert.deepEqual(r["/redirect"].headers.filter(([name]) => name === "set-cookie"), [["set-cookie", "a=1"], ["set-cookie", "b=2"]]);
  assert.deepEqual(r["/redirect"].headers.find(([name]) => name === "location"), ["location", "/ok"]);
});

test("Range requests return 206 with intact Content-Range, Content-Length and exactly the requested bytes", () => {
  assert.equal(r.range.upstreamSawRange, "bytes=10-19");
  assert.equal(r.range.status, 206);
  assert.deepEqual(r.range.headers.find(([n]) => n === "content-range"), ["content-range", "bytes 10-19/1000"]);
  assert.deepEqual(r.range.headers.find(([n]) => n === "content-length"), ["content-length", "10"]);
  assert.deepEqual(r.range.headers.find(([n]) => n === "content-type"), ["content-type", "video/mp4"]);
  assert.deepEqual(pick(r.range, ["ended", "bytes"]), { ended: "clean", bytes: 10 });
  assert.deepEqual(pick(r.rangeOpenEnded, ["status", "ended", "bytes"]), { status: 206, ended: "clean", bytes: 10 });
  assert.deepEqual(r.rangeOpenEnded.headers.find(([n]) => n === "content-range"), ["content-range", "bytes 990-999/1000"]);
  assert.deepEqual(pick(r.range416, ["status", "ended", "bytes"]), { status: 416, ended: "clean", bytes: 0 });
});

test("complete bodies of every framing, including a large stream, end cleanly with every byte", () => {
  assert.deepEqual(pick(r.chunkedOk, ["ended", "bytes", "text"]), { ended: "clean", bytes: 11, text: "hello world" });
  assert.deepEqual(pick(r.gzipOk, ["ended", "bytes"]), { ended: "clean", bytes: 20_000 });
  assert.deepEqual(pick(r.big, ["ended", "bytes"]), { ended: "clean", bytes: 8_388_608 });
});

test("a transfer that curl reports as failed errors the body instead of looking complete", () => {
  for (const key of ["/clen-drop", "/chunked-drop", "/gzip-drop"]) {
    assert.equal(r[key].ended, "error", key);
    assert.match(r[key].error, /error code 18: Transferred a partial file/, key);
    assert.ok(r[key].bytes > 0, `${key} still delivered the bytes that arrived before the failure`);
  }
  // No Content-Length and no chunking: the end of the body cannot be told from a normal close.
  assert.equal(r.eofDelimitedDrop.ended, "clean");
  assert.deepEqual(r.afterTruncations, clean);
});

test("a truncated POST response errors and the POST is sent exactly once", () => {
  assert.equal(r.postTruncated.ended, "error");
  assert.equal(r.postTruncated.postsSeen, 1);
});

test("cancelling bodies after headers frees bookkeeping and upstream sockets, and repeated cancel is harmless", () => {
  assert.deepEqual(pick(r.cancelAfterHeaders, Object.keys(clean)), clean);
  assert.equal(r.cancelAfterHeaders.upstreamSocketsOpened, 12);
  assert.equal(r.cancelAfterHeaders.upstreamOpen, 0);
});

test("a host with more cancelled requests than libcurl's per-host cap still serves new requests", () => {
  assert.deepEqual(pick(r.hostStillServes, ["ended", "bytes"]), { ended: "clean", bytes: 5 });
});

test("aborting before response headers rejects the request, frees bookkeeping, and tolerates a second abort", () => {
  assert.equal(r.abortBeforeHeaders.outcomes.length, 4);
  assert.ok(r.abortBeforeHeaders.outcomes.every((outcome) => outcome !== "resolved"));
  assert.deepEqual(pick(r.abortBeforeHeaders, Object.keys(clean)), clean);
});

test("abort racing completion, and cancelling an already finished body, neither corrupts results nor leaks", () => {
  assert.equal(r.raceAndLateCancel.outcomes.length, 8);
  assert.ok(r.raceAndLateCancel.outcomes.every((outcome) => outcome === "clean" || outcome === "error"));
  assert.deepEqual(pick(r.raceAndLateCancel, Object.keys(clean)), clean);
});

test("simultaneous completed, cancelled and truncated requests each get the right outcome and leave nothing behind", () => {
  const counts = r.simultaneous.outcomes.reduce((acc, o) => ({ ...acc, [o]: (acc[o] ?? 0) + 1 }), {});
  assert.deepEqual(counts, { clean: 12, cancelled: 6, error: 6 });
  assert.deepEqual(pick(r.simultaneous, Object.keys(clean)), clean);
  assert.equal(r.simultaneous.upstreamOpen, 0);
});

test("a connection failure before headers rejects with a TypeError and leaves nothing behind", () => {
  assert.equal(r.connectionRefused.outcome, "rejected");
  assert.equal(r.connectionRefused.name, "TypeError");
  assert.deepEqual(pick(r.connectionRefused, Object.keys(clean)), clean);
});

test("the libcurl-transport patch is registered and present in the file the browser loads", async () => {
  const workspace = await readFile(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8");
  assert.match(workspace, /'@mercuryworkshop\/libcurl-transport@2\.0\.5': patches\/@mercuryworkshop__libcurl-transport@2\.0\.5\.patch/);
  const served = await readFile(new URL("../artifacts/snorlax-cave/node_modules/@mercuryworkshop/libcurl-transport/dist/index.mjs", import.meta.url), "utf8");
  assert.match(served, /this\.end_callback\(request_id, -1\)/);
  assert.match(served, /if \(error > 0 && headers_received/);
});
