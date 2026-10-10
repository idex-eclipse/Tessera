export interface ColumnDef {
  key: string; // НЕ union — колонки расширяются без правок типов
  labelKey: string;
  always?: boolean;
}

export const COLUMNS: ColumnDef[] = [
  { key: 'thumbnail', labelKey: 'jobs.thumbnail' },
  { key: 'name', labelKey: 'jobs.name', always: true },
  { key: 'status', labelKey: 'jobs.status' },
  { key: 'size', labelKey: 'jobs.size' },
  { key: 'modified', labelKey: 'jobs.modified' },
  { key: 'last_print', labelKey: 'jobs.lastPrint' },
  { key: 'estimated_time', labelKey: 'jobs.estimatedTime' },
  { key: 'slicer', labelKey: 'jobs.slicer' },
  { key: 'layer_height', labelKey: 'jobs.layerHeight' },
  { key: 'first_layer_height', labelKey: 'jobs.firstLayerHeight' },
  { key: 'layer_count', labelKey: 'jobs.layerCount' },
  { key: 'object_height', labelKey: 'jobs.objectHeight' },
  { key: 'nozzle_diameter', labelKey: 'jobs.nozzleDiameter' },
  { key: 'filament_name', labelKey: 'jobs.filamentName' },
  { key: 'filament_type', labelKey: 'jobs.filamentType' },
  { key: 'filament_colors', labelKey: 'jobs.filamentColors' },
  { key: 'extruder_colors', labelKey: 'jobs.extruderColors' },
  { key: 'filament_total', labelKey: 'jobs.filamentTotal' },
  { key: 'filament_length', labelKey: 'jobs.filamentLengths' },
  { key: 'filament_weight', labelKey: 'jobs.filamentWeights' },
  { key: 'filament_weight_total', labelKey: 'jobs.filamentWeight' },
  { key: 'first_layer_extruder_temp', labelKey: 'jobs.extruderTemp' },
  { key: 'first_layer_bed_temp', labelKey: 'jobs.bedTemp' },
  { key: 'chamber_temp', labelKey: 'jobs.chamberTemp' },
];

export const PAGE_DEFAULTS = [
  'name', 'status', 'size', 'filament_name', 'filament_colors', 'filament_type',
  'filament_weight', 'filament_total', 'estimated_time', 'modified',
];

export const WIDGET_DEFAULTS = ['name', 'status', 'size', 'modified'];