// Development-only benchmark: real libcurl.js + real wisp-js server + a controlled mock upstream.
// Nothing here is imported by the app. Results are SYNTHETIC (plain-HTTP loopback, no TLS, no
// CDN, no real TikTok): they show how each transport handles streaming, cancellation and
// connection limits, not whether any real site works.
//
//   node scripts/transport-bench.mjs                      # all built-in variants, JSON in $BENCH_OUT
//   EPOXY_TRANSPORT_MODULE=/abs/epoxy-transport/dist/index.mjs node scripts/transport-bench.mjs
//
// Epoxy is not a project dependency. It only runs if EPOXY_TRANSPORT_MODULE points at a local copy
// of @mercuryworkshop/epoxy-transport; otherwise it is reported as skipped.
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const cave = path.join(root, "artifacts/snorlax-cave");
const variants = ["libcurl-raw", "libcurl+cancelableTransport", ...(process.env.EPOXY_TRANSPORT_MODULE ? ["epoxy"] : [])];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms))]);
const median = (values) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null);
const round = (value) => (value == null ? null : Math.round(value * 10) / 10);

let partial = null;

async function runVariant(variant) {
  // libcurl.js picks its environment at import time and rejects Node; hide `process` only while importing.
  const realProcess = globalThis.process;
  globalThis.window = globalThis;
  globalThis.document = { currentScript: null, addEventListener() {}, dispatchEvent() {} };
  Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
  const { LibcurlClient } = await import(pathToFileURL(path.join(cave, "node_modules/@mercuryworkshop/libcurl-transport/dist/index.mjs")).href);
  Object.defineProperty(globalThis, "process", { value: realProcess, configurable: true, writable: true });
  const wisp = await import(pathToFileURL(path.join(root, "artifacts/api-server/node_modules/@mercuryworkshop/wisp-js/src/entrypoints/server.mjs")).href);
  const { cancelableTransport } = await import(pathToFileURL(path.join(cave, "public/assets/js/scramjet-runtime.js")).href);
  wisp.server.options.allow_loopback_ips = true;
  wisp.server.options.allow_private_ips = true;

  // ---- mock upstream ----
  const reqs = new Map();
  const upstream = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const id = url.searchParams.get("id") ?? `anon${reqs.size}`;
    const st = { startedAt: performance.now(), closedAt: null, finished: false, bytes: 0, path: url.pathname, range: req.headers.range ?? null, received: req.url };
    reqs.set(id, st);
    res.on("close", () => {
      st.closedAt = performance.now();
      st.finished = res.writableFinished;
    });
    const size = Number(url.searchParams.get("size") ?? 1_000_000);
    const chunk = Number(url.searchParams.get("chunk") ?? 65536);
    const delay = Number(url.searchParams.get("delay") ?? 0);
    const body = (n) => Buffer.alloc(n, 97);
    if (url.pathname === "/range") {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
      if (!match) { res.writeHead(200, { "content-length": size, "accept-ranges": "bytes" }); return res.end(body(size)); }
      const start = Number(match[1]);
      const end = Math.min(match[2] === "" ? size - 1 : Number(match[2]), size - 1);
      if (start >= size) { res.writeHead(416, { "content-range": `bytes */${size}`, "content-length": 0 }); return res.end(); }
      res.writeHead(206, { "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1, "accept-ranges": "bytes", "content-type": "video/mp4" });
      return res.end(body(end - start + 1));
    }
    if (url.pathname === "/redirect") { res.writeHead(302, { location: `/range?size=${size}&id=${id}-target` }); return res.end(); }
    if (url.pathname === "/forbidden") { res.writeHead(403, { "content-length": 9 }); return res.end("forbidden"); }
    if (url.pathname === "/drop") {
      res.writeHead(200, { "content-length": size });
      res.write(body(Math.floor(size / 2)));
      await sleep(20);
      return req.socket.destroy();
    }
    if (url.pathname === "/stall") {
      res.writeHead(200, { "content-length": size });
      res.write(body(1024));
      return; // never sends more and never ends; only a close ends it
    }
    // /stream: paced (delay > 0) or as fast as the client drains (delay = 0)
    res.writeHead(200, { "content-length": size, "content-type": "video/mp4" });
    let sent = 0;
    while (sent < size && !res.destroyed) {
      const n = Math.min(chunk, size - sent);
      const ok = res.write(body(n));
      sent += n;
      st.bytes = sent;
      if (delay) await sleep(delay);
      else if (!ok) await new Promise((resolve) => { res.once("drain", resolve); res.once("close", resolve); });
    }
    if (!res.destroyed) res.end();
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const gateway = http.createServer();
  gateway.on("upgrade", (req, socket, head) => wisp.server.routeRequest(req, socket, head));
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${upstream.address().port}`;
  const wispUrl = `ws://127.0.0.1:${gateway.address().port}/wisp/`;

  // ---- transport under test ----
  let transport;
  if (variant === "epoxy") {
    const mod = await import(pathToFileURL(process.env.EPOXY_TRANSPORT_MODULE).href);
    transport = new (mod.default ?? mod.EpoxyTransport)({ wisp: wispUrl });
  } else {
    transport = new LibcurlClient({ wisp: wispUrl });
  }
  await withTimeout(transport.init(), 30_000, "transport.init");
  if (variant === "libcurl+cancelableTransport") transport = cancelableTransport(transport);

  let seq = 0;
  const newId = () => `${variant.replace(/[^a-z0-9]/gi, "_")}_${seq++}`;
  const request = (pathAndQuery, headers = []) => {
    const id = newId();
    const sep = pathAndQuery.includes("?") ? "&" : "?";
    return { id, promise: transport.request(new URL(`${base}${pathAndQuery}${sep}id=${id}`), "GET", null, headers, undefined) };
  };
  const readAll = async (body) => {
    const reader = body.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return total;
      total += value.byteLength;
    }
  };
  const waitClosed = async (id, since, limitMs) => {
    const deadline = performance.now() + limitMs;
    while (performance.now() < deadline) {
      const st = reqs.get(id);
      if (st?.closedAt) return st.closedAt - since;
      await sleep(5);
    }
    return null; // upstream connection was still open when we gave up
  };
  const openUpstream = () => [...reqs.values()].filter((st) => !st.closedAt).length;
  const only = process.env.BENCH_ONLY ? process.env.BENCH_ONLY.split(",") : null;
  const want = (name) => !only || only.includes(name);
  const results = { variant, environment: { node: process.version, cpus: os.cpus().length, platform: process.platform, arch: process.arch, libcurlJs: "0.7.4 (via libcurl-transport 2.0.5)" } };
  partial = results;

  process.stderr.write(`[${variant}] S1\n`);
  // S1: correctness. Status, redirects, range semantics, error statuses and the exact upstream URL.
  if (want("S1")) {
    const out = {};
    const ranged = request("/range?size=1000&sig=AbC%2Bx&exp=1760000000", [["range", "bytes=100-199"]]);
    const r = await ranged.promise;
    out.range206 = { status: r.status, contentRange: r.headers.find(([k]) => k.toLowerCase() === "content-range")?.[1], bytes: await readAll(r.body), upstreamRange: reqs.get(ranged.id).range, upstreamUrl: reqs.get(ranged.id).received.replace(/id=[^&]+/, "id=*") };
    const r416 = await request("/range?size=1000", [["range", "bytes=5000-"]]).promise;
    out.range416 = { status: r416.status, contentRange: r416.headers.find(([k]) => k.toLowerCase() === "content-range")?.[1], bytes: await readAll(r416.body) };
    const rr = await request("/redirect?size=500").promise;
    out.redirectManual = { status: rr.status, location: rr.headers.find(([k]) => k.toLowerCase() === "location")?.[1]?.replace(/id=[^&]+/, "id=*") };
    await readAll(rr.body);
    const rf = await request("/forbidden").promise;
    out.forbidden403 = { status: rf.status, bytes: await readAll(rf.body) };
    const drop = request("/drop?size=200000");
    const dr = await drop.promise;
    try { out.midStreamDisconnect = { outcome: "ended", bytes: await withTimeout(readAll(dr.body), 5000, "drop") }; } catch (error) { out.midStreamDisconnect = { outcome: "error", error: String(error?.message ?? error).slice(0, 80) }; }
    results.correctness = out;
  }

  process.stderr.write(`[${variant}] S2\n`);
  // S2: time to first byte and throughput for one 16 MB fast stream (3 runs).
  if (want("S2")) {
    const runs = [];
    for (let i = 0; i < 3; i += 1) {
      const started = performance.now();
      const r = await request("/stream?size=16000000&chunk=65536").promise;
      const ttfb = performance.now() - started;
      const bytes = await readAll(r.body);
      const total = performance.now() - started;
      runs.push({ ttfbMs: round(ttfb), totalMs: round(total), mbPerSec: round(bytes / 1e6 / (total / 1000)), bytes });
    }
    results.throughput = { runs, medianTtfbMs: median(runs.map((x) => x.ttfbMs)), medianMbPerSec: median(runs.map((x) => x.mbPerSec)) };
  }

  process.stderr.write(`[${variant}] S5\n`);
  // S5: backpressure. Read headers of a 64 MB fast stream and never read the body.
  if (want("S5")) {
    const rssBefore = process.memoryUsage().rss;
    const rq = request("/stream?size=64000000&chunk=65536");
    const r = await rq.promise;
    await sleep(3000);
    const sentWhileUnread = reqs.get(rq.id).bytes;
    const rssGrowthMb = round((process.memoryUsage().rss - rssBefore) / 1e6);
    const cancelledAt = performance.now();
    await r.body.cancel("done").catch(() => {});
    results.backpressure = { totalBytes: 64_000_000, upstreamSentWhileBodyUnread: sentWhileUnread, rssGrowthMbWhileUnread: rssGrowthMb, upstreamFinishedBeforeCancel: Boolean(reqs.get(rq.id).closedAt && reqs.get(rq.id).closedAt < cancelledAt), closedAfterCancelMs: reqs.get(rq.id).closedAt && reqs.get(rq.id).closedAt < cancelledAt ? null : round(await waitClosed(rq.id, cancelledAt, 4000)) };
  }

  process.stderr.write(`[${variant}] S6\n`);
  // S6: repeated seeks: 20 range requests on a fast stream, each cancelled after its first chunk.
  if (want("S6")) {
    const started = performance.now();
    const ids = [];
    for (let i = 0; i < 20; i += 1) {
      const rq = request("/stream?size=30000000&chunk=65536&delay=5");
      const r = await withTimeout(rq.promise, 8000, "seek open").catch(() => null);
      if (!r) break;
      const reader = r.body.getReader();
      await reader.read();
      await reader.cancel("seek");
      ids.push(rq.id);
    }
    await sleep(1500);
    results.repeatedSeeks = { requests: ids.length, elapsedMs: round(performance.now() - started), upstreamStillOpen: ids.filter((id) => !reqs.get(id).closedAt).length };
  }

  process.stderr.write(`[${variant}] S7\n`);
  // S7: 12 concurrent paced streams to one host, read fully.
  if (want("S7")) {
    const started = performance.now();
    const ttfbs = [];
    const done = await Promise.allSettled(Array.from({ length: 12 }, async () => {
      const s = performance.now();
      const r = await request("/stream?size=2000000&chunk=32768&delay=10").promise;
      ttfbs.push(performance.now() - s);
      return readAll(r.body);
    }));
    results.concurrent12 = { fulfilled: done.filter((x) => x.status === "fulfilled").length, rejected: done.filter((x) => x.status === "rejected").length, wallMs: round(performance.now() - started), maxTtfbMs: round(Math.max(...ttfbs)) };
  }
  process.stderr.write(`[${variant}] S3\n`);
  // S3: abort-to-cleanup. Read one chunk, cancel the body, time until the upstream connection closes.
  for (const [name, pathAndQuery] of !want("S3") ? [] : [["slowStream20ms", "/stream?size=20000000&chunk=16384&delay=20"]]) {
    const times = [];
    for (let i = 0; i < 5; i += 1) {
      const rq = request(pathAndQuery);
      const r = await rq.promise;
      const reader = r.body.getReader();
      await reader.read();
      const cancelledAt = performance.now();
      await reader.cancel("test");
      times.push(await waitClosed(rq.id, cancelledAt, 4000));
    }
    results[`cancelCleanup_${name}`] = { msPerRun: times.map(round), neverClosedWithin4s: times.filter((t) => t == null).length, medianMs: median(times.filter((t) => t != null)) };
  }

  process.stderr.write(`[${variant}] S4`+"\n");
  // S4: cancel streams whose upstream goes quiet (stalled/throttled CDN). Count how many requests
  // to one host succeed before the next one hangs (libcurl.js caps connections at 6 per host).
  if (want("S4")) {
    const opened = [];
    let blockedAt = null;
    for (let i = 0; i < 9; i += 1) {
      const rq = request("/stall?size=20000000");
      const r = await withTimeout(rq.promise, 4000, "open").catch(() => null);
      if (!r) { blockedAt = i + 1; break; }
      const reader = r.body.getReader();
      await reader.read();
      const cancelledAt = performance.now();
      await reader.cancel("seek");
      opened.push({ id: rq.id, cancelledAt });
    }
    await sleep(1500);
    const stillOpen = opened.filter(({ id }) => !reqs.get(id).closedAt).length;
    results.stalledCancel = { cancelled: opened.length, upstreamStillOpen1500msAfterCancel: stillOpen, requestThatHungForGood: blockedAt };
    const started = performance.now();
    const probe = request("/range?size=1000");
    results.stalledCancel.newRequestToSameHost = await withTimeout(probe.promise, 4000, "probe").then(async (r) => { await readAll(r.body); return { status: r.status, ttfbMs: round(performance.now() - started) }; }).catch((error) => ({ hung: true, error: String(error.message) }));
  }
  results.rssMbAtEnd = round(process.memoryUsage().rss / 1e6);
  return results;
}

if (process.argv[2] === "--variant") {
  const variant = process.argv[3];
  const watchdog = setTimeout(() => { console.log(`RESULT ${JSON.stringify({ ...partial, variant, error: "variant exceeded 90 s (partial results above this point)" })}`); process.exit(0); }, 90_000);
  runVariant(variant)
    .then((results) => console.log(`RESULT ${JSON.stringify(results)}`))
    .catch((error) => console.log(`RESULT ${JSON.stringify({ variant, error: String(error?.stack ?? error).slice(0, 400) })}`))
    .finally(() => { clearTimeout(watchdog); process.exit(0); });
} else {
  const all = [];
  for (const variant of variants) {
    const stdout = await new Promise((resolve) => execFile(process.execPath, [import.meta.filename, "--variant", variant], { maxBuffer: 1 << 24, timeout: 150_000 }, (_error, out) => resolve(out)));
    const line = String(stdout).split("\n").find((l) => l.startsWith("RESULT "));
    all.push(line ? JSON.parse(line.slice(7)) : { variant, error: "no result" });
  }
  const outPath = process.env.BENCH_OUT ?? path.join(os.tmpdir(), "transport-bench-results.json");
  writeFileSync(outPath, JSON.stringify(all, null, 2));
  console.log(JSON.stringify(all, null, 2));
  console.log(`\nraw results written to ${outPath}`);
}
