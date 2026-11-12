import { createServer as createViteServer } from 'vite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import viteConfig from '../../vite.config.ts';
import { startMockMoonrakerServer } from './server.js';
import { createMockSessionStore } from './sessions.js';

const HOST = '127.0.0.1';
const UI_PORT = 5174;
const ORIGIN = `http://${HOST}:${UI_PORT}`;

/** Starts both printer origins and Vite; browser tests use the same launcher as the local command. */
export async function startMockDev(): Promise<{
  url: string;
  session: ReturnType<ReturnType<typeof createMockSessionStore>['getOrCreate']>;
  close: () => Promise<void>;
}> {
  const sessions = createMockSessionStore();
  const session = sessions.getOrCreate('local');
  const ready = await startMockMoonrakerServer({ state: session.ready, host: HOST, port: 17125, allowedOrigin: ORIGIN });
  let error: Awaited<ReturnType<typeof startMockMoonrakerServer>>;
  try {
    error = await startMockMoonrakerServer({ state: session.error, host: HOST, port: 17126, allowedOrigin: ORIGIN });
  } catch (cause) {
    await ready.close();
    throw cause;
  }
  let vite;
  try {
    vite = await createViteServer({
      ...viteConfig,
      // The runner already loaded the TypeScript config; avoid Vite's temporary config file.
      configFile: false,
      cacheDir: join(tmpdir(), 'tessera-vite-mock'),
      mode: 'mock',
      server: { host: HOST, port: UI_PORT, strictPort: true },
    });
    await vite.listen();
  } catch (cause) {
    await vite?.close();
    await Promise.all([ready.close(), error.close()]);
    throw cause;
  }
  vite.printUrls();
  console.info(`Mock printers: ${ready.url} (ready), ${error.url} (Klipper error)`);

  // One signal handler closes both origins and Vite so no mock process is left behind.
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await vite.close();
    await Promise.all([ready.close(), error.close()]);
    sessions.dispose();
  };
  return { url: ORIGIN, session, close };
}

/** Registers signal cleanup only for the standalone npm command. */
async function main(): Promise<void> {
  const app = await startMockDev();
  const close = async () => app.close();
  process.on('SIGINT', () => { void close().then(() => process.exit(0)); });
  process.on('SIGTERM', () => { void close().then(() => process.exit(0)); });
}

// Importing this file for browser scenarios must not start a second copy of the server.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error('[dev:mock] startup failed', error);
    process.exitCode = 1;
  });
}
