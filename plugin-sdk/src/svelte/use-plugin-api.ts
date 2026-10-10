import { getContext, setContext } from 'svelte';
import type { PluginApi } from '../types';

const PLUGIN_API_KEY = Symbol('plugin-api');

export function providePluginApi(api: PluginApi): void {
  setContext(PLUGIN_API_KEY, api);
}

export function usePluginApi(): PluginApi {
  const api = getContext<PluginApi>(PLUGIN_API_KEY);
  if (!api) {
    throw new Error('[plugin-sdk] usePluginApi() called outside of plugin context');
  }
  return api;
}