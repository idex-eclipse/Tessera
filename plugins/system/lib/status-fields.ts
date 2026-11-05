/** How progress is measured: by file position, by elapsed/estimated time, or by filament used. */
export type ProgressMode = 'file' | 'time' | 'filament';

export type StatusFieldId =
  | 'speed' | 'flow' | 'filament'
  | 'slicer' | 'elapsed' | 'total'
  | 'layer' | 'remaining' | 'eta';

export const FIELD_GROUPS: Array<{ id: string; titleKey: string; fields: StatusFieldId[] }> = [
  { id: 'live', titleKey: 'system.status.groupLive', fields: ['speed', 'flow', 'filament'] },
  { id: 'time', titleKey: 'system.status.groupTime', fields: ['slicer', 'elapsed', 'total'] },
  { id: 'forecast', titleKey: 'system.status.groupForecast', fields: ['layer', 'remaining', 'eta'] },
];

export const DEFAULT_FIELDS: StatusFieldId[] = FIELD_GROUPS.flatMap((g) => g.fields);

/**
 * Normalizes the stored `status.fields` value. Nothing stored (or garbage) means every field is
 * shown; an explicit empty list means the user switched them all off.
 */
export function parseEnabledFields(raw: unknown): StatusFieldId[] {
  if (Array.isArray(raw)) return DEFAULT_FIELDS.filter((f) => raw.includes(f));
  return [...DEFAULT_FIELDS];
}
