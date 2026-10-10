import type { PluginApi } from '../types';
import { usePluginApi } from './use-plugin-api';

export function useI18n(): PluginApi['i18n'] {
  const api = usePluginApi();
  return api.i18n;
}