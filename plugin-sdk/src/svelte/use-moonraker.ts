import type { MoonrakerProxyHandle } from '../types';
import { usePluginApi } from './use-plugin-api';

/**
 * Returns the stable MoonrakerProxyHandle that follows the active printer on each call.
 * Existing subscriptions stay on the old printer: re-create them in onPrinterChange.
 * Throws if there is no active printer.
 */
export function useMoonraker(): MoonrakerProxyHandle {
  const api = usePluginApi();
  return api.moonraker();
}