/** Состояния Klipper, о которых сообщает баннер: видимость — решение плагина (M). */
const BAD_STATES = ['error', 'shutdown', 'startup', 'disconnected'];

export function isKlipperBannerVisible(state: string): boolean {
  return BAD_STATES.includes(state);
}

/** i18n-ключ заголовка баннера для состояния Klipper. */
export function klipperBannerTitleKey(state: string): string {
  if (state === 'error') return 'system.klipperBanner.error';
  if (state === 'shutdown') return 'system.klipperBanner.shutdown';
  if (state === 'startup') return 'system.klipperBanner.starting';
  return 'system.klipperBanner.disconnected';
}
