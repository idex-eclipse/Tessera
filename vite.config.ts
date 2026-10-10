import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Раздача <project>/extensions/ в dev: те же URL, что в prod через nginx. */
function serveExtensions(): Plugin {
  const root = path.resolve(process.cwd(), 'extensions');
  return {
    name: 'serve-extensions',
    configureServer(server) {
      server.middlewares.use('/extensions', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]);
        const file = path.join(root, rel);
        if (!file.startsWith(root + path.sep)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          next();
          return;
        }
        const ext = path.extname(file);
        res.setHeader(
          'Cache-Control',
          ext === '.json' || ext === '.js'
            ? 'no-cache'
            : 'public, max-age=31536000, immutable',
        );
        if (ext === '.json') res.setHeader('Content-Type', 'application/json');
        if (ext === '.js') res.setHeader('Content-Type', 'text/javascript');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

svelte({
  compilerOptions: {
    warningFilter: (warning) => {
      return !warning.code.startsWith('a11y-') || !warning.code.startsWith('state_referenced') || !warning.code.startsWith('node_invalid');
    },
  },
});

export default defineConfig({
  plugins: [svelte(), serveExtensions()],
  root: 'host',

  resolve: {
    alias: {
      '@sdk': new URL('./plugin-sdk/src', import.meta.url).pathname,
    },
  },

  server: {
    host: true,
    port: 5173,
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});