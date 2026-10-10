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
    environment: 'node',

    include: [
      'host/src/**/*.{test,spec}.ts',
      'plugin-sdk/src/**/*.{test,spec}.ts',
      'plugins/**/*.{test,spec}.ts'
    ],

    clearMocks: true,
    restoreMocks: true,
  },
});