import express, { type Express } from "express";
import path from "node:path";
import cors from "cors";
import pinoHttp from "pino-http";
import healthRouter from "./routes/health";
import { logger } from "./lib/logger";
import { precompressedStatic } from "./lib/precompressed";

const app: Express = express();

app.set("trust proxy", 1);
// The app serves mutable HTML and a service-worker-backed static site. Do not
// let Express turn stale browser validators into 304 responses in preview.
app.disable("etag");

app.use((req, res, next) => {
  if (req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.path === "/sw.js" || req.path === "/scramjet-sw.js") {
    res.setHeader("Cache-Control", "no-cache");
  } else if (/^\/(assets|uv|scramjet|controller|libcurl)\//.test(req.path)) {
    res.setHeader("Cache-Control", "public, max-age=3600");
  } else {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", healthRouter);

if (process.env.CHAT_DISABLED === "true") {
  app.use("/api/chat", (_req, res) => {
    res.status(503).json({ error: "Chat is unavailable when started without a database." });
  });
} else {
  const { default: chatRouter } = await import("./routes/chat");
  app.use("/api/chat", chatRouter);
}

const staticRoot = path.resolve(
  import.meta.dirname,
  "../../../artifacts/snorlax-cave/dist/public",
);

const sendPage = (filename: string) => {
  return (_req: express.Request, res: express.Response) =>
    res.sendFile(path.join(staticRoot, filename), {
      cacheControl: false,
      lastModified: false,
    });
};

const pages: Record<string, string> = {
  "/": "/index.html",
  "/math": "/Games.html",
  "/english": "/Apps.html",
  "/about": "/About.html",
  "/chat": "/chat.html",
  "/settings": "/Settings.html",
  "/portal": "/loader.html",
  "/dashboard": "/agloader.html",
};

app.use(precompressedStatic(staticRoot, pages));

for (const [route, file] of Object.entries(pages)) {
  app.get(route, sendPage(file.slice(1)));
}

app.use(
  express.static(staticRoot, {
    cacheControl: false,
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      if (path.extname(filePath).toLowerCase() === ".wasm") {
        res.type("application/wasm");
      }
    },
  }),
);

export default app;
