import { cpSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'path';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { scramjetPath } from '@mercuryworkshop/scramjet/path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const trimDuplicateDocumentPlugin = () => ({
  name: 'trim-duplicate-document',
  transformIndexHtml(html: string) {
    const firstDocumentEnd = html.indexOf('</html>');
    if (firstDocumentEnd === -1) return html;

    const firstDocument = html.slice(0, firstDocumentEnd + '</html>'.length);
    return firstDocument;
  },
});

const pipelineAsync = promisify(pipeline);
const controllerPath = path.dirname(fileURLToPath(import.meta.resolve('@mercuryworkshop/scramjet-controller')));
const libcurlPath = path.dirname(fileURLToPath(import.meta.resolve('@mercuryworkshop/libcurl-transport')));
const proxyAssets = [
  { url: '/scramjet/scramjet.js', source: path.join(scramjetPath, 'scramjet.js') },
  { url: '/scramjet/scramjet.wasm', source: path.join(scramjetPath, 'scramjet.wasm') },
  { url: '/controller/controller.api.js', source: path.join(controllerPath, 'controller.api.js') },
  { url: '/controller/controller.inject.js', source: path.join(controllerPath, 'controller.inject.js') },
  { url: '/controller/controller.sw.js', source: path.join(controllerPath, 'controller.sw.js') },
  { url: '/libcurl/index.mjs', source: path.join(libcurlPath, 'index.mjs') },
];

const proxyAssetsPlugin = (outDir: string) => ({
  name: 'serve-proxy-engine-assets',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use(async (request, response, next) => {
      if (!request.url) return next();
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const asset = proxyAssets.find(({ url }) => decodeURIComponent(url) === pathname);
      if (!asset || !existsSync(asset.source) || !statSync(asset.source).isFile()) return next();

      response.setHeader('Content-Type', asset.source.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'public, max-age=3600');
      await pipelineAsync(createReadStream(asset.source), response);
    });
  },
  writeBundle() {
    for (const { url, source } of proxyAssets) {
      const destination = path.join(outDir, url.slice(1));
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(source, destination);
    }
  },
});

const rawPort = process.env.PORT ?? '5000';

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [
    proxyAssetsPlugin(path.resolve(import.meta.dirname, 'dist/public')),
    trimDuplicateDocumentPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
