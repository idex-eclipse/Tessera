import type { PluginApi } from '../types';
import { usePluginApi } from './use-plugin-api';

/**
 * Composite hook for widget components.
 * Provides access to the full PluginApi.
 */
export function useWidget(): PluginApi {
  return usePluginApi();
}