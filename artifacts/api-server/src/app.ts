import express, { type Express } from "express";
import path from "node:path";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.set("trust proxy", 1);
// The app serves mutable HTML and a service-worker-backed static site. Do not
// let Express turn stale browser validators into 304 responses in preview.
app.disable("etag");

app.use((req, res, next) => {
  const forwardedProto = req.get("x-forwarded-proto");

  if (forwardedProto === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
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

app.use("/api", router);

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

app.get("/", sendPage("index.html"));
app.get("/math", sendPage("Games.html"));
app.get("/english", sendPage("Apps.html"));
app.get("/about", sendPage("About.html"));
app.get("/chat", sendPage("chat.html"));
app.get("/settings", sendPage("Settings.html"));
app.get("/portal", sendPage("loader.html"));
app.get("/dashboard", sendPage("agloader.html"));

app.use(
  express.static(staticRoot, {
    cacheControl: false,
    etag: false,
    lastModified: false,
  }),
);

export default app;
