import type { PluginApi } from '../../../plugin-sdk/src/types';

import { parseGcodeAsync } from './parse-client';
import type { ParsedGcode } from './parse-gcode';

export type GcodeEntry =
  | { status: 'loading' }
  | { status: 'ok'; parsed: ParsedGcode }
  | { status: 'error'; message: string };

let byFile = $state<Record<string, GcodeEntry>>({});

export function ensureParsed(api: PluginApi, path: string): void {
  if (!path || byFile[path]) return;
  byFile[path] = { status: 'loading' };

  (async () => {
    try {
      const url = `${api.moonraker().httpBaseUrl}/server/files/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      byFile[path] = { status: 'ok', parsed: await parseGcodeAsync(text) };
      const parsed = await parseGcodeAsync(text);
      console.info('[gcode] types:', parsed.typeNames, 'extruders:', parsed.extruderCount);
    } catch (e) {
      byFile[path] = { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  })();
}

export function getEntry(path: string): GcodeEntry | undefined {
  return path ? byFile[path] : undefined;
}