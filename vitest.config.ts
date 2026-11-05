import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],

  resolve: {
    alias: {
      '@mpu/plugin-sdk': fileURLToPath(
        new URL('./plugin-sdk/src', import.meta.url),
      ),
    },
  },

  test: {
    clearMocks: true,
    restoreMocks: true,

    // Two projects. In the `node` environment Svelte is compiled in SERVER mode, where runes are
    // inert (`$effect` / `$effect.root` never run), so it cannot test reactivity. Tests that need
    // real client-side reactivity are named `*.dom.test.ts` and run in jsdom, where Svelte is
    // compiled for the browser.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'host/src/**/*.{test,spec}.ts',
            'plugin-sdk/src/**/*.{test,spec}.ts',
            'plugins/**/*.{test,spec}.ts',
          ],
          exclude: ['**/node_modules/**', '**/*.dom.test.ts'],
        },
      },
      {
        extends: true,
        // The `svelte` package only exposes its client runtime (mount, flushSync, effects)
        // under the `browser` export condition.
        resolve: { conditions: ['browser'] },
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['host/src/**/*.dom.test.ts', 'plugins/**/*.dom.test.ts'],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
});
