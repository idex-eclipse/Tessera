import type { PluginApi } from '../../../plugin-sdk/src/types';

export type PreviewVariant = 'page' | 'widget';

let clearedMap = $state<Record<string, boolean>>({});

function key(api: PluginApi, variant: PreviewVariant): string {
  return `${api.printer.id}:${variant}`;
}

export function isCleared(api: PluginApi, variant: PreviewVariant): boolean {
  return clearedMap[key(api, variant)] ?? false;
}

export function unclear(api: PluginApi, variant: PreviewVariant): void {
  clearedMap[key(api, variant)] = false;
}

export function clearPreview(api: PluginApi, variant: PreviewVariant): void {
  clearedMap[key(api, variant)] = true;

  const pid = api.printer.id;
  const base = variant === 'page' ? `#/p/${pid}/gcode-preview` : `#/p/${pid}`;
  globalThis.location.replace(base); // без записи в историю
}