import type { MoonrakerProxyHandle } from '../types';
import { usePluginApi } from './use-plugin-api';

/**
 * Returns the MoonrakerProxyHandle for the current active printer.
 * Re-call after onPrinterChange to get the new printer's handle.
 */
export function useMoonraker(): MoonrakerProxyHandle {
  const api = usePluginApi();
  return api.moonraker();
}