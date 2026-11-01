/**
 * Как показать баннеры при данной высоте рабочей области.
 *
 * Хост старается оставить баннеры на виду и убирает их по ступеням: отдельный слишком высокий →
 * все сразу (чтобы не было расхождения по стилю) → под аккордеон. На узком экране места нет
 * заведомо: баннеры свёрнуты всегда, а несколько — всегда под аккордеоном.
 *
 * Высоты естественные и не зависят от текущего вида, поэтому режимы не переключаются по кругу.
 * Чистая логика: тестируется без DOM.
 */

/** Доли высоты рабочей области. */
export const MAX_BANNER_SHARE = 0.35;
export const MAX_TOTAL_SHARE = 0.4;
export const MAX_COLLAPSED_SHARE = 0.25;

export interface BannerMeasure {
  key: string;
  /** 0 — плагину нечего сообщать, баннер не виден. */
  fullHeight: number;
  collapsedHeight: number;
}

export interface BannerLayout {
  collapsed: Set<string>;
  grouped: boolean;
}

export function computeBannerLayout({
  narrow,
  available,
  banners,
}: {
  narrow: boolean;
  /** Высота рабочей области; 0 — ещё не измерена. */
  available: number;
  banners: readonly BannerMeasure[];
}): BannerLayout {
  const visible = banners.filter((banner) => banner.fullHeight > 0);
  const allKeys = () => new Set(visible.map((banner) => banner.key));

  if (narrow) return { collapsed: allKeys(), grouped: visible.length > 1 };
  if (available <= 0) return { collapsed: new Set(), grouped: false };

  const tooTall = new Set(
    visible
      .filter((banner) => banner.fullHeight > available * MAX_BANNER_SHARE)
      .map((banner) => banner.key),
  );
  const total = visible.reduce(
    (sum, banner) => sum + (tooTall.has(banner.key) ? banner.collapsedHeight : banner.fullHeight),
    0,
  );
  if (total <= available * MAX_TOTAL_SHARE) return { collapsed: tooTall, grouped: false };

  const collapsedTotal = visible.reduce((sum, banner) => sum + banner.collapsedHeight, 0);
  return {
    collapsed: allKeys(),
    grouped: visible.length > 1 && collapsedTotal > available * MAX_COLLAPSED_SHARE,
  };
}
