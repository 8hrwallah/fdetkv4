// Runs the real libcurl.js transport (libcurl-transport, with our patch) and the real wisp-js server
// against a local raw-TCP upstream, and writes per-scenario results as JSON to argv[2].
// Spawned by tests/libcurl-transport.test.mjs; libcurl.js keeps timers/websockets alive, so this
// process ends with process.exit().
import http from "node:http";
import net from "node:net";
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const cave = path.join(root, "artifacts/snorlax-cave");
const outFile = process.argv[2];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hardStop = setTimeout(() => {
  writeFileSync(outFile, JSON.stringify({ harnessError: "hard timeout" }));
  process.exit(2);
}, 90_000);

// libcurl.js rejects Node at import time; hide `process` only while importing.
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

const gzipped = zlib.gzipSync(Buffer.from(Array.from({ length: 20_000 }, (_, i) => (i * 7919) % 251)));
const state = { sockets: 0, openSockets: 0, posts: 0, lastRange: null };
const head = (status, headers) => `HTTP/1.1 ${status}\r\n${headers.join("\r\n")}\r\n\r\n`;

const upstream = net.createServer((sock) => {
  state.sockets += 1;
  state.openSockets += 1;
  sock.on("close", () => { state.openSockets -= 1; });
  sock.on("error", () => {});
  let buf = "";
  sock.on("data", (data) => {
    buf += data;
    if (!buf.includes("\r\n\r\n")) return;
    const [requestLine, ...lines] = buf.split("\r\n");
    buf = "";
    const [method, target] = requestLine.split(" ");
    const range = lines.find((l) => /^range:/i.test(l))?.split(":")[1].trim() ?? null;
    if (method === "POST") state.posts += 1;
    const url = new URL(target, "http://x");
    const size = Number(url.searchParams.get("size") ?? 0);
    const dropLater = () => setTimeout(() => sock.destroy(), 50);
    switch (url.pathname) {
      case "/ok":
        sock.write(head("200 OK", ["content-type: text/plain", "content-length: 5", "connection: close"]) + "hello");
        sock.end();
        break;
      case "/status403":
        sock.write(head("403 Forbidden", ["content-length: 9", "content-type: text/plain", "connection: close"]) + "forbidden");
        sock.end();
        break;
      case "/status500":
        sock.write(head("500 Internal Server Error", ["content-length: 4", "connection: close"]) + "oops");
        sock.end();
        break;
      case "/redirect":
        sock.write(head("302 Found", ["location: /ok", "set-cookie: a=1", "set-cookie: b=2", "content-length: 0", "connection: close"]));
        sock.end();
        break;
      case "/range": {
        state.lastRange = range;
        const m = /^bytes=(\d+)-(\d*)$/.exec(range ?? "");
        const total = 1000;
        if (!m) {
          sock.write(head("200 OK", [`content-length: ${total}`, "accept-ranges: bytes", "connection: close"]) + "x".repeat(total));
        } else if (Number(m[1]) >= total) {
          sock.write(head("416 Range Not Satisfiable", [`content-range: bytes */${total}`, "content-length: 0", "connection: close"]));
        } else {
          const start = Number(m[1]);
          const end = Math.min(m[2] === "" ? total - 1 : Number(m[2]), total - 1);
          sock.write(head("206 Partial Content", [`content-range: bytes ${start}-${end}/${total}`, `content-length: ${end - start + 1}`, "content-type: video/mp4", "accept-ranges: bytes", "connection: close"]) + "r".repeat(end - start + 1));
        }
        sock.end();
        break;
      }
      case "/big": {
        sock.write(head("200 OK", [`content-length: ${size}`, "content-type: video/mp4", "connection: close"]));
        let sent = 0;
        const chunk = Buffer.alloc(65_536, 98);
        const pump = () => {
          while (sent < size) {
            const part = chunk.subarray(0, Math.min(chunk.length, size - sent));
            sent += part.length;
            if (!sock.write(part)) { sock.once("drain", pump); return; }
          }
          sock.end();
        };
        pump();
        break;
      }
      case "/clen-drop":
        sock.write(head("200 OK", ["content-length: 5000"]) + "a".repeat(1000));
        dropLater();
        break;
      case "/chunked-drop":
        sock.write(head("200 OK", ["transfer-encoding: chunked"]) + "400\r\n" + "a".repeat(1024) + "\r\n");
        dropLater();
        break;
      case "/gzip-drop":
        sock.write(Buffer.concat([Buffer.from(head("200 OK", ["content-encoding: gzip", `content-length: ${gzipped.length}`])), gzipped.subarray(0, gzipped.length >> 1)]));
        dropLater();
        break;
      case "/gzip-ok":
        sock.write(Buffer.concat([Buffer.from(head("200 OK", ["content-encoding: gzip", `content-length: ${gzipped.length}`, "connection: close"])), gzipped]));
        sock.end();
        break;
      case "/chunked-ok":
        sock.write(head("200 OK", ["transfer-encoding: chunked", "connection: close"]) + "5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n");
        sock.end();
        break;
      case "/eof-drop":
        sock.write(head("200 OK", ["connection: close"]) + "a".repeat(1000));
        dropLater();
        break;
      case "/stall":
        sock.write(head("200 OK", ["content-length: 100000"]) + "a".repeat(1000));
        break;
      case "/hang":
        break;
      default:
        sock.write(head("404 Not Found", ["content-length: 0", "connection: close"]));
        sock.end();
    }
  });
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const gateway = http.createServer();
gateway.on("upgrade", (req, socket, headPart) => wisp.server.routeRequest(req, socket, headPart));
await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${upstream.address().port}`;

const transport = cancelableTransport(new LibcurlClient({ wisp: `ws://127.0.0.1:${gateway.address().port}/wisp/` }));
await transport.init();
const session = transport.session;
const bookkeeping = () => ({
  active: session.active_requests,
  callbacks: Object.keys(session.request_callbacks).length,
  inFlight: session.requests_list.length,
  loopRunning: Boolean(session.event_loop),
});
const settle = async () => { await sleep(400); return bookkeeping(); };
const call = (p, { method = "GET", headers = [], body = null, signal } = {}) =>
  transport.request(new URL(base + p), method, body, new Headers(headers), signal);
const consume = async (response) => {
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { ended: "clean", bytes, text: Buffer.concat(chunks).toString().slice(0, 64) };
      bytes += value.byteLength;
      if (chunks.length < 4) chunks.push(Buffer.from(value));
    }
  } catch (error) {
    return { ended: "error", bytes, error: String(error) };
  }
};
const describe = (response) => ({ status: response.status, headers: response.headers });

const results = {};

// Status codes, headers and bodies survive unchanged (including 4xx/5xx, redirects, duplicate headers).
for (const p of ["/ok", "/status403", "/status500", "/missing", "/redirect"]) {
  const response = await call(p);
  results[p] = { ...describe(response), ...(await consume(response)) };
}

// Range handling.
const ranged = await call("/range", { headers: [["Range", "bytes=10-19"]] });
results.range = { ...describe(ranged), ...(await consume(ranged)), upstreamSawRange: state.lastRange };
const openEnded = await call("/range", { headers: [["Range", "bytes=990-"]] });
results.rangeOpenEnded = { ...describe(openEnded), ...(await consume(openEnded)) };
const unsatisfiable = await call("/range", { headers: [["Range", "bytes=5000-"]] });
results.range416 = { ...describe(unsatisfiable), ...(await consume(unsatisfiable)) };

// Complete bodies of every framing end cleanly.
results.chunkedOk = await consume(await call("/chunked-ok"));
results.gzipOk = await consume(await call("/gzip-ok"));
results.big = await consume(await call("/big?size=8388608"));

// Truncated bodies must fail, never look complete.
for (const p of ["/clen-drop", "/chunked-drop", "/gzip-drop"]) results[p] = await consume(await call(p));
results.eofDelimitedDrop = await consume(await call("/eof-drop")); // length unknowable, stays a clean end
results.afterTruncations = await settle();

// A POST is sent exactly once, even when the response is cut off.
const before = state.posts;
const post = await call("/clen-drop", { method: "POST", body: new Uint8Array([1, 2, 3]) });
results.postTruncated = { ...(await consume(post)), postsSeen: state.posts - before };

// Cancellation after headers: bookkeeping and upstream sockets are released, repeated cancel is safe.
const socketsBefore = state.sockets;
for (let i = 0; i < 12; i += 1) {
  const response = await call("/stall");
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel("skip");
  await reader.cancel("skip again");
}
results.cancelAfterHeaders = { ...(await settle()), upstreamSocketsOpened: state.sockets - socketsBefore, upstreamOpen: state.openSockets };

// More cancelled requests than the 6-per-host cap: the host must still serve a new request.
results.hostStillServes = await Promise.race([call("/ok").then(consume), sleep(8000).then(() => ({ ended: "timeout" }))]);

// Cancellation before headers arrive, with the caller signal, then a repeated abort.
const aborts = [];
for (let i = 0; i < 4; i += 1) {
  const controller = new AbortController();
  const pending = call("/hang", { signal: controller.signal }).then(() => "resolved", (error) => error.name);
  await sleep(80);
  controller.abort();
  controller.abort();
  aborts.push(await pending);
}
results.abortBeforeHeaders = { outcomes: aborts, ...(await settle()) };

// Abort racing a normal completion, and a cancel after the body fully completed.
const raceOutcomes = [];
for (let i = 0; i < 8; i += 1) {
  const controller = new AbortController();
  const response = await call("/ok", { signal: controller.signal });
  const consumed = consume(response);
  controller.abort();
  raceOutcomes.push((await consumed).ended);
}
const finished = await call("/ok");
const finishedReader = finished.body.getReader();
while (!(await finishedReader.read()).done);
await finishedReader.cancel("late");
results.raceAndLateCancel = { outcomes: raceOutcomes, ...(await settle()) };

// Simultaneous mix of completing, cancelled, truncated and normal requests.
const mixed = await Promise.all(Array.from({ length: 24 }, async (_, i) => {
  try {
    if (i % 4 === 0) return (await consume(await call("/big?size=1048576"))).ended;
    if (i % 4 === 1) { const r = await call("/stall"); const rd = r.body.getReader(); await rd.read(); await rd.cancel(); return "cancelled"; }
    if (i % 4 === 2) return (await consume(await call("/clen-drop"))).ended;
    return (await consume(await call("/ok"))).ended;
  } catch (error) {
    return `rejected:${error.name}`;
  }
}));
results.simultaneous = { outcomes: mixed, ...(await settle()), upstreamOpen: state.openSockets };

// A connection failure before headers rejects cleanly and leaves nothing behind.
const dead = net.createServer();
await new Promise((resolve) => dead.listen(0, "127.0.0.1", resolve));
const deadPort = dead.address().port;
await new Promise((resolve) => dead.close(resolve));
try {
  await transport.request(new URL(`http://127.0.0.1:${deadPort}/`), "GET", null, new Headers(), undefined);
  results.connectionRefused = { outcome: "resolved" };
} catch (error) {
  results.connectionRefused = { outcome: "rejected", name: error.name, ...(await settle()) };
}

writeFileSync(outFile, JSON.stringify(results));
clearTimeout(hardStop);
process.exit(0);
