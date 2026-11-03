import { PLUGIN_API } from '../../../plugin-sdk/src/api-level';

/**
 * Какая это сборка Tessera: подставляет vite.config.ts (define __TESSERA_BUILD__).
 * Для людей — About, экспорт настроек, отчёты об ошибках. Совместимость плагинов
 * проверяется по PLUGIN_API, а не по версии сборки.
 */
declare const __TESSERA_BUILD__: { version: string; commit: string; branch: string } | undefined;

export const BUILD_INFO = {
  ...(typeof __TESSERA_BUILD__ !== 'undefined'
    ? __TESSERA_BUILD__
    : { version: '0.0.0-dev', commit: 'unknown', branch: 'unknown' }),
  pluginApi: PLUGIN_API,
};
