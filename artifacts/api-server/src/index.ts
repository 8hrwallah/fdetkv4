import http from "node:http";
import https from "node:https";
import net from "node:net";
import { server as wispServer } from "@mercuryworkshop/wisp-js/server";
import { createBareServer } from "@tomphttp/bare-server-node";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Limits are per Wisp WebSocket (one is shared by all Tabbed frames). The filter counts the
// stream being opened, so the effective caps are one lower. libcurl-transport allows 50
// HTTP connections (6 per host); TikTok peaked near 60 sockets across many hosts.
wispServer.options.stream_limit_total = 200;
wispServer.options.stream_limit_per_host = 32;

const server = http.createServer();

server.keepAliveTimeout = 5_000;
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;

const bareServer = createBareServer("/bare/", {
  httpAgent: new http.Agent({
    keepAlive: true,
    maxSockets: 128,
    maxFreeSockets: 32,
    timeout: 120_000,
  }),
  httpsAgent: new https.Agent({
    keepAlive: true,
    maxSockets: 128,
    maxFreeSockets: 32,
    timeout: 120_000,
  }),
  connectionLimiter: {
    maxConnectionsPerIP: 5_000,
    windowDuration: 60,
    blockDuration: 1,
  },
});

function isTrustedProxyPeer(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (ip === "::1") return true;
  if (net.isIPv6(ip)) return /^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip);
  return (
    /^(127|10)\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)
  );
}

// Bare's default trusts the first (client-controlled) X-Forwarded-For entry. Behind the single
// reverse proxy (matching `trust proxy` 1) use the entry the proxy appended; for direct
// connections ignore forwarding headers entirely.
(bareServer as unknown as { getClientIP: (req: http.IncomingMessage) => string | undefined }).getClientIP = (req) => {
  const peer = req.socket.remoteAddress;
  if (isTrustedProxyPeer(peer)) {
    const header = req.headers["x-forwarded-for"];
    const raw = Array.isArray(header) ? header.join(",") : header;
    const last = raw?.split(",").pop()?.trim();
    if (last && net.isIP(last)) return last;
  }
  return peer;
};

server.on("request", (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
    return;
  }

  app(req, res);
});

server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/wisp/")) {
    const startedAt = Date.now();
    const path = "/wisp/";
    logger.info({ path, event: "websocket-upgrade" }, "Wisp transport upgrade requested");
    socket.once("close", (hadError) => {
      logger.info(
        { path, event: "websocket-close", hadError, durationMs: Date.now() - startedAt },
        "Wisp transport socket closed",
      );
    });
    socket.on("error", (err) => {
      logger.warn({ path, event: "websocket-error", code: "code" in err ? err.code : undefined }, "Wisp transport socket error");
    });
    try {
      wispServer.routeRequest(req, socket, head);
    } catch (err) {
      logger.error({ path, event: "websocket-upgrade-error", err }, "Wisp transport upgrade failed");
      socket.destroy();
    }
    return;
  }

  if (bareServer.shouldRoute(req)) {
    bareServer.routeUpgrade(req, socket, head);
    return;
  }

  socket.end();
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});

server.on("error", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
});
