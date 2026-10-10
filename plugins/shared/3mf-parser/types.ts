// Контракт 3MF-инспектора (lineage OrcaSlicer/Bambu, по анализу реальных экспортов).
// Парсер чистый: без Svelte-состояния, без запросов, без строк i18n —
// предупреждения отдаются кодами, локализует плагин-потребитель (ключи tmf.*).

export type ThreeMFVendor = 'orca' | 'bambu' | 'unknown';

export type ThreeMFWarningCode =
  | 'no-plates'
  | 'no-gcode'
  | 'plate-gcode-missing'
  | 'unknown-vendor'
  | 'model-settings-missing'
  | 'project-settings-broken'
  | 'plate-json-broken';

export interface ThreeMFWarning {
  code: ThreeMFWarningCode;
  plateId?: number;
}

export interface ThreeMFPlateObject {
  name: string;
  identifyId?: number;
  extruder?: number;
  skipped: boolean;
}

export interface ThreeMFPlateFilament {
  id: number;
  trayInfoIdx?: string;
  type?: string;
  color?: string;
  usedM?: number;
  usedG?: number;
  nozzleDiameter?: number;
}

/** Срез-сводка пластины из Metadata/slice_info.config (форма B). */
export interface ThreeMFPlateSlice {
  predictionSec?: number;   // prediction, целые секунды
  weightG?: number;
  firstLayerSec?: number;   // ВНИМАНИЕ: в файле возможна десятичная запятая
  supportUsed?: boolean;
  labelObjectEnabled?: boolean;
  nozzleDiameters?: number[];
  objects: ThreeMFPlateObject[];
  filaments: ThreeMFPlateFilament[];
}

/** Побочные сведения из Metadata/plate_<id>.json (есть в обеих формах). */
export interface ThreeMFPlateInfo {
  bedType?: string;
  nozzleDiameter?: number;
  firstLayerSec?: number;
  bboxAll?: number[];
  objects?: { name: string; area?: number }[];
  isSeqPrint?: boolean;
  filamentIds?: string[];
  filamentColors?: string[];
}

export interface ThreeMFPlate {
  id: number;
  name: string;                 // plater_name || `Plate ${id}`
  gcodePath?: string;           // только если запись реально есть в архиве
  gcodeSize?: number;           // uncompressed size из central directory
  thumbnailPath?: string;
  topPath?: string;
  pickPath?: string;
  noLightPath?: string;
  bboxPath?: string;
  filamentSlots: number[];      // filament_maps "1 2" → [1, 2]
  objects: ThreeMFPlateObject[];
  slice?: ThreeMFPlateSlice;
  info?: ThreeMFPlateInfo;
}

export interface ThreeMFFilamentSlot {
  slot: number;                 // 1-based индекс массивов project_settings
  type?: string;
  color?: string;
  vendor?: string;
  profileId?: string;
  filamentId?: string;
}

export interface ThreeMFPrinterInfo {
  model?: string;
  printerProfile?: string;
  processProfile?: string;
  gcodeFlavor?: string;
  agent?: string;
}

export interface ThreeMFInspection {
  vendor: ThreeMFVendor;
  slicerVersion?: string;
  hasGcode: boolean;            // ТОЛЬКО по факту zip-записей, не по [Content_Types].xml
  plates: ThreeMFPlate[];
  filamentSlots: ThreeMFFilamentSlot[];
  printer?: ThreeMFPrinterInfo;
  layerHeight?: number;
  coverPath?: string;
  warnings: ThreeMFWarning[];
}

export interface ThreeMFHandle {
  readonly inspection: ThreeMFInspection;
  /** Ленивое извлечение части архива (превью, gcode) — только по явному действию UI. */
  extractBlob(path: string): Promise<Blob>;
  plateThumbnail(plateId: number): Promise<Blob | null>;
  plateGcode(plateId: number): Promise<Blob>;
  /** Зарезервировано симметрии API (сейчас no-op): object URL создаёт и гасит потребитель. */
  close(): void;
}