import type { ExtensionPointDecl } from '../../../plugin-sdk/src/types';

/**
 * Extension point of the shared SliderField. Like the FileTable, SliderField is bundled into each
 * plugin that embeds it and talks to the host as THAT plugin, so the point exists only for a plugin
 * that declares it in its own manifest. A plugin that does not declare it keeps the built-in slider.
 *
 * Keep the id in sync with the `<ExtensionPoint>` in SliderField.svelte (a test compares them).
 */
export const SLIDER_POINT_ID = 'slider';

/** Bubbling, composed events a replacing extension dispatches back to the SliderField. */
export const SLIDER_EVENTS = {
  /** The user chose a value: `detail: { value: number }`. SliderField clamps it to min/max. */
  commit: 'mpu:slider-commit',
  /** The user pressed "reset" (only when `resettable` is `'true'`). */
  reset: 'mpu:slider-reset',
} as const;

/**
 * Declaration of the slider point for a plugin manifest.
 *
 * Replacement (not alternative): a slider is drawn dozens of times on a dashboard, a chooser per
 * instance would be unusable. Only the visuals are replaced: the clamping, the pending-value
 * guard and the commands stay in SliderField, an extension only reports a value or a reset.
 *
 * @param i18nPrefix Plugin i18n root that holds `ext.slider` (the name shown in host dialogs and
 *   Settings → Plugins).
 * @returns Point declarations to spread into `manifest.extensionPoints`.
 */
export function sliderPoints(i18nPrefix: string): ExtensionPointDecl[] {
  return [
    { id: SLIDER_POINT_ID, kind: 'element', mode: 'replacement', version: 1, titleKey: `${i18nPrefix}.ext.slider` },
  ];
}
