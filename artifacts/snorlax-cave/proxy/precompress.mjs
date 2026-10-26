import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const COMPRESSIBLE = new Set([".js", ".mjs", ".css", ".html", ".json", ".svg", ".wasm", ".txt", ".xml"]);
const MIN_BYTES = 1024;
const MAX_BYTES = 3 * 1024 * 1024;
export const MANIFEST_NAME = "precompressed.json";

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

// Writes .br/.gz siblings for text-like build output and a manifest the server uses to
// serve them. Done once at build time so requests never spend CPU on compression.
export function precompressDirectory(root) {
  const manifest = {};
  for (const file of walk(root)) {
    if (!COMPRESSIBLE.has(path.extname(file).toLowerCase())) continue;
    const { size } = statSync(file);
    if (size < MIN_BYTES || size > MAX_BYTES) continue;
    const body = readFileSync(file);
    const encodings = [];
    const br = brotliCompressSync(body, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: size },
    });
    if (br.length < size * 0.9) {
      writeFileSync(`${file}.br`, br);
      encodings.push("br");
    }
    const gz = gzipSync(body, { level: 9 });
    if (gz.length < size * 0.9) {
      writeFileSync(`${file}.gz`, gz);
      encodings.push("gz");
    }
    if (encodings.length) manifest["/" + path.relative(root, file).split(path.sep).join("/")] = encodings;
  }
  writeFileSync(path.join(root, MANIFEST_NAME), JSON.stringify(manifest));
  return manifest;
}
