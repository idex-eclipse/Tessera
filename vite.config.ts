import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

import { corePluginVersions } from './host/src/core-manifests';

/**
 * core-plugins.json в сборке: версии встроенных плагинов для deploy/tessera-ext.py
 * (manifest.dependencies дополнений на @core/* проверяются до установки).
 */
function emitCorePlugins(): Plugin {
  return {
    name: 'emit-core-plugins',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'core-plugins.json',
        source: JSON.stringify(corePluginVersions(), null, 2) + '\n',
      });
    },
  };
}

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

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Какая это сборка — для людей (Settings → About, экспорт настроек), не для проверок:
 * совместимость плагинов решает PLUGIN_API (plugin-sdk/src/api-level.ts).
 * version — `git describe` от последнего тега релиза: X.X.X на теге, X.X.X-X-g<commit> между ними.
 */
function buildInfo(): { version: string; commit: string; branch: string } {
  const describe = git('describe', '--tags', '--match', 'v[0-9]*', '--dirty');
  const commit = git('rev-parse', '--short=7', 'HEAD') ?? 'unknown';
  return {
    version: describe ? describe.replace(/^v/, '') : `0.0.0-g${commit}`,
    commit,
    branch: process.env.TESSERA_BUILD_BRANCH || git('rev-parse', '--abbrev-ref', 'HEAD') || 'unknown',
  };
}

export default defineConfig({
  define: {
    __TESSERA_BUILD__: JSON.stringify(buildInfo()),
  },
  plugins: [
    svelte({
      onwarn(warning, handler) {
        if (warning.code?.startsWith('a11y')) return;
        if (warning.code?.startsWith('state_')) return;
        if (warning.code?.startsWith('node')) return;
        if (warning.code?.startsWith('css')) return;
        handler(warning);
      },
    }), 
    serveExtensions(),
    emitCorePlugins(),
  ],
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
    chunkSizeWarningLimit: 2000,
  },
});