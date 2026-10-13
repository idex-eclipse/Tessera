import type { QuickChipLayoutItem } from '../../../plugin-sdk/src/types';

/**
 * Кураторский стандартный состав полосы quick-access.
 * Порядок = порядок в полосе (слева направо).
 * id для temperature chips — канонические Klipper-имена объектов
 * (extruder, heater_bed есть у ~99% принтеров; если отсутствуют —
 *  чипы станут ghost через существующую механику контейнера).
 * id для livez фиксирован ('livez') — один предмет в picker.
 * Состав — продуктовое решение хоста, плагины не вписываются.
 */
const DEFAULT_CHIPS: ReadonlyArray<{
  type: string;
  provider: string;
  id: string;
}> = [
  { type: 'temperature', provider: '@core/widgets',     id: 'extruder'    },
  { type: 'temperature', provider: '@core/widgets',     id: 'heater_bed'  },
  { type: 'livez',       provider: '@core/calibrations', id: 'livez'       },
];

function makeId(type: string, chipId: string, index: number): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `default-${type}-${chipId}-${index}-${Date.now().toString(36)}`;
}

/**
 * Билдер стандартных чипов. Резолвер не нужен: провайдеры жёстко прописаны
 * в константе (у chips нет defaultSize, а provider всегда известен из манифеста).
 * Если плагин не зарегистрирован — пропускаем (sanitize).
 */
export function buildDefaultChips(
  hasProvider: (type: string, provider: string) => boolean,
): QuickChipLayoutItem[] {
  const items: QuickChipLayoutItem[] = [];
  DEFAULT_CHIPS.forEach((d, i) => {
    if (!hasProvider(d.type, d.provider)) return;
    items.push({
      instanceId: makeId(d.type, d.id, i),
      type: d.type,
      provider: d.provider,
      id: d.id,
    });
  });
  return items;
}