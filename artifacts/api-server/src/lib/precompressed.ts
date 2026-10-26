import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";

const ENCODINGS = [
  { token: "br", suffix: ".br" },
  { token: "gzip", suffix: ".gz" },
] as const;
const SUFFIX_TO_MANIFEST = { ".br": "br", ".gz": "gz" } as const;

function loadManifest(staticRoot: string): Map<string, Set<string>> {
  try {
    const raw = JSON.parse(readFileSync(path.join(staticRoot, "precompressed.json"), "utf8")) as Record<string, string[]>;
    return new Map(Object.entries(raw).map(([name, encodings]) => [name, new Set(encodings)]));
  } catch {
    return new Map();
  }
}

function accepts(header: string | undefined, token: string): boolean {
  if (!header) return false;
  return header.split(",").some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (name !== token) return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return !q || Number(q.slice(2)) > 0;
  });
}

// Serves the .br/.gz files written at build time for the paths listed in the manifest.
// Only exact manifest paths are eligible, so it never touches proxy, API or stream traffic.
export function precompressedStatic(staticRoot: string, pages: Record<string, string> = {}): RequestHandler {
  const manifest = loadManifest(staticRoot);
  return (req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || manifest.size === 0 || req.headers.range) {
      next();
      return;
    }
    const target = pages[req.path] ?? req.path;
    const available = manifest.get(target);
    if (!available) {
      next();
      return;
    }
    const acceptEncoding = req.headers["accept-encoding"];
    res.vary("Accept-Encoding");
    const choice = ENCODINGS.find(({ token, suffix }) => available.has(SUFFIX_TO_MANIFEST[suffix]) && accepts(acceptEncoding, token));
    if (!choice) {
      next();
      return;
    }
    const file = path.join(staticRoot, target + choice.suffix);
    const extension = path.extname(target).toLowerCase();
    res.type(extension === ".wasm" ? "application/wasm" : extension);
    res.setHeader("Content-Encoding", choice.token);
    res.sendFile(file, { cacheControl: false, etag: false, lastModified: false } as never, (error) => {
      if (error) {
        res.removeHeader("Content-Encoding");
        if (!res.headersSent) next();
      }
    });
  };
}
