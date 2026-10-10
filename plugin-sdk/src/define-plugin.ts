import type { PluginManifest } from './types';

/**
 * Temporary v2 stub.
 *
 * In this phase it only preserves manifest typing.
 * No runtime behavior is added yet.
 */
export function definePlugin<T extends PluginManifest>(manifest: T): T {
  return manifest;
}