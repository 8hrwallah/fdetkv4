import http from "node:http";
import https from "node:https";
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
    maxConnectionsPerIP: 100_000,
    windowDuration: 60,
    blockDuration: 1,
  },
});

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
