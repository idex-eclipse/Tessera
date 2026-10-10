// Инспектор 3MF: формы A (проект/STL-экспорт, без gcode) и B (столы с gcode).
// Детекция gcode — ТОЛЬКО по факту zip-записей: [Content_Types].xml декларирует
// тип gcode всегда (проверено на образце без gcode), поэтому не читается вовсе.
// 3D/3dmodel.model не читается (тяжело и не нужно: превью хватает PNG).

import { openZip, ZipError, type ZipArchive } from './zip-reader';
import type {
  ThreeMFHandle,
  ThreeMFInspection,
  ThreeMFPlate,
  ThreeMFPlateFilament,
  ThreeMFPlateInfo,
  ThreeMFPlateObject,
  ThreeMFPlateSlice,
  ThreeMFFilamentSlot,
  ThreeMFVendor,
  ThreeMFWarning,
} from './types';

const P_MODEL_SETTINGS = 'Metadata/model_settings.config';
const P_MODEL_SETTINGS_RELS = 'Metadata/_rels/model_settings.config.rels';
const P_PROJECT_SETTINGS = 'Metadata/project_settings.config';
const P_SLICE_INFO = 'Metadata/slice_info.config';
const P_ROOT_RELS = '_rels/.rels';

const RE_PLATE_GCODE = /^Metadata\/plate_\d+\.gcode$/i;
const RE_ANY_GCODE = /\.gcode$/i;
const RE_PLATE_PNG = /^Metadata\/plate_(\d+)\.png$/i;

const norm = (p: string) => p.replace(/^\/+/, '');

/** Orca пишет часть чисел с десятичной ЗАПЯТОЙ (first_layer_time="33,626049"). */
function parseLocaleFloat(v: string | undefined): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function splitNums(v: string | undefined, sep: string): number[] | undefined {
  if (!v) return undefined;
  const out = v.split(sep).map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  return out.length ? out : undefined;
}

function parseBool(v: string | undefined): boolean | undefined {
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

function xmlDoc(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return doc.getElementsByTagName('parsererror').length ? null : doc;
}

/** metadata-children вида <metadata key=".." value=".."/> → record. */
function metaMap(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const child of Array.from(el.children)) {
    if (child.tagName === 'metadata') {
      const k = child.getAttribute('key');
      if (k) out[k] = child.getAttribute('value') ?? '';
    }
  }
  return out;
}

interface RawPlate {
  meta: Record<string, string>;
  instanceObjectIds: number[];
}

interface RawSlicePlate {
  meta: Record<string, string>;
  objects: ThreeMFPlateObject[];
  filaments: ThreeMFPlateFilament[];
}

function parseModelSettings(text: string): { plates: Map<number, RawPlate>; objects: Map<number, { name: string; extruder?: number }> } | null {
  const doc = xmlDoc(text);
  if (!doc) return null;
  const plates = new Map<number, RawPlate>();
  const objects = new Map<number, { name: string; extruder?: number }>();
  for (const el of Array.from(doc.documentElement.children)) {
    if (el.tagName === 'object') {
      const id = Number(el.getAttribute('id'));
      const meta = metaMap(el);
      if (Number.isFinite(id) && meta.name) {
        objects.set(id, { name: meta.name, extruder: meta.extruder !== undefined ? Number(meta.extruder) : undefined });
      }
    } else if (el.tagName === 'plate') {
      const meta = metaMap(el);
      const id = Number(meta.plater_id);
      if (!Number.isFinite(id)) continue;
      const instanceObjectIds: number[] = [];
      for (const inst of Array.from(el.children)) {
        if (inst.tagName !== 'model_instance') continue;
        const im = metaMap(inst);
        const oid = Number(im.object_id);
        if (Number.isFinite(oid)) instanceObjectIds.push(oid);
      }
      plates.set(id, { meta, instanceObjectIds });
    }
  }
  return { plates, objects };
}

function parseSliceInfo(text: string): { header: Record<string, string>; plates: Map<number, RawSlicePlate> } | null {
  const doc = xmlDoc(text);
  if (!doc) return null;
  const header: Record<string, string> = {};
  const plates = new Map<number, RawSlicePlate>();
  for (const el of Array.from(doc.documentElement.children)) {
    if (el.tagName === 'header') {
      for (const item of Array.from(el.children)) {
        const k = item.getAttribute('key');
        if (k) header[k] = item.getAttribute('value') ?? '';
      }
    } else if (el.tagName === 'plate') {
      const meta = metaMap(el);
      const index = Number(meta.index);
      if (!Number.isFinite(index)) continue;
      const objects: ThreeMFPlateObject[] = [];
      const filaments: ThreeMFPlateFilament[] = [];
      for (const child of Array.from(el.children)) {
        if (child.tagName === 'object') {
          objects.push({
            name: child.getAttribute('name') ?? '',
            identifyId: Number(child.getAttribute('identify_id')) || undefined,
            skipped: child.getAttribute('skipped') === 'true',
          });
        } else if (child.tagName === 'filament') {
          filaments.push({
            id: Number(child.getAttribute('id')) || 0,
            trayInfoIdx: child.getAttribute('tray_info_idx') ?? undefined,
            type: child.getAttribute('type') ?? undefined,
            color: child.getAttribute('color') ?? undefined,
            usedM: parseLocaleFloat(child.getAttribute('used_m') ?? undefined),
            usedG: parseLocaleFloat(child.getAttribute('used_g') ?? undefined),
            nozzleDiameter: parseLocaleFloat(child.getAttribute('nozzle_diameter') ?? undefined),
          });
        }
      }
      plates.set(index, { meta, objects, filaments });
    }
  }
  return { header, plates };
}

function parsePlateJson(text: string): ThreeMFPlateInfo | null {
  try {
    const j = JSON.parse(text);
    return {
      bedType: typeof j.bed_type === 'string' ? j.bed_type : undefined,
      nozzleDiameter: typeof j.nozzle_diameter === 'number' ? j.nozzle_diameter : undefined,
      firstLayerSec: typeof j.first_layer_time === 'number' ? j.first_layer_time : undefined,
      bboxAll: Array.isArray(j.bbox_all) ? j.bbox_all : undefined,
      objects: Array.isArray(j.bbox_objects)
        ? j.bbox_objects.map((o: { name?: string; area?: number }) => ({ name: o.name ?? '', area: o.area }))
        : undefined,
      isSeqPrint: typeof j.is_seq_print === 'boolean' ? j.is_seq_print : undefined,
      filamentIds: Array.isArray(j.filament_ids) ? j.filament_ids : undefined,
      filamentColors: Array.isArray(j.filament_colors) ? j.filament_colors : undefined,
    };
  } catch {
    return null;
  }
}

/** 'OrcaCube_v2.drc_id_0_copy_0' → 'OrcaCube_v2'. */
export function prettifyObjectName(name: string): string {
  return name
    .replace(/_id_\d+(_copy_\d+)?$/i, '')
    .replace(/\.(drc|stl|obj|step|stp|amf|3mf)$/i, '');
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gcode: 'text/x-gcode',
  json: 'application/json',
  config: 'application/xml',
  md5: 'text/plain',
};

function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

function assertSafePath(path: string): void {
  if (!path || path.includes('..') || path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes('\\')) {
    throw new ZipError('unsafe-path', path);
  }
}

export async function openThreeMF(
  blob: Blob,
  opts: { signal?: AbortSignal } = {},
): Promise<ThreeMFHandle> {
  const arc = await openZip(blob, opts);
  const warnings: ThreeMFWarning[] = [];

  const read = async (path: string): Promise<string | null> => {
    const e = arc.getEntry(path);
    return e ? arc.readText(e, opts.signal) : null;
  };

  // --- gcode: только факт записей -------------------------------------------
  const gcodeEntries = arc.find(RE_PLATE_GCODE);
  const anyGcode = gcodeEntries.length ? gcodeEntries : arc.find(RE_ANY_GCODE);
  const hasGcode = anyGcode.length > 0;
  const gcodeByPlate = new Map<number, string>();
  for (const e of gcodeEntries) {
    const m = e.name.match(/plate_(\d+)\.gcode$/i);
    if (m) gcodeByPlate.set(Number(m[1]), e.name);
  }

  // --- служебные XML/JSON ----------------------------------------------------
  const msText = await read(P_MODEL_SETTINGS);
  const ms = msText ? parseModelSettings(msText) : null;
  if (!ms) warnings.push({ code: 'model-settings-missing' });

  const relsText = await read(P_MODEL_SETTINGS_RELS);
  const relsGcode = new Set<string>();
  if (relsText) {
    const doc = xmlDoc(relsText);
    if (doc) {
      for (const rel of Array.from(doc.documentElement.children)) {
        if ((rel.getAttribute('Type') ?? '').endsWith('/gcode')) {
          relsGcode.add(norm(rel.getAttribute('Target') ?? ''));
        }
      }
    }
  }

  const siText = await read(P_SLICE_INFO);
  const si = siText ? parseSliceInfo(siText) : null;

  let project: Record<string, unknown> | null = null;
  const psText = await read(P_PROJECT_SETTINGS);
  if (psText) {
    try {
      project = JSON.parse(psText);
    } catch {
      warnings.push({ code: 'project-settings-broken' });
    }
  }

  // --- vendor / version ------------------------------------------------------
  let vendor: ThreeMFVendor = 'unknown';
  let slicerVersion: string | undefined;
  const orcaV = si?.header['OrcaSlicer-Version'];
  const bambuV = si?.header['BambuStudio-Version'];
  if (orcaV) {
    vendor = 'orca';
    slicerVersion = orcaV;
  } else if (bambuV) {
    vendor = 'bambu';
    slicerVersion = bambuV;
  } else {
    warnings.push({ code: 'unknown-vendor' });
  }

  // --- обложка пакета ---------------------------------------------------------
  let coverPath: string | undefined;
  const rootRelsText = await read(P_ROOT_RELS);
  if (rootRelsText) {
    const doc = xmlDoc(rootRelsText);
    if (doc) {
      let fallback: string | undefined;
      for (const rel of Array.from(doc.documentElement.children)) {
        const type = rel.getAttribute('Type') ?? '';
        const target = norm(rel.getAttribute('Target') ?? '');
        if (!target || !arc.getEntry(target)) continue;
        if (type.endsWith('/metadata/thumbnail')) {
          coverPath = target;
          break;
        }
        if (type.includes('cover-thumbnail-middle')) fallback = target;
      }
      coverPath ??= fallback;
    }
  }

  // --- ids пластин: union всех источников -------------------------------------
  const ids = new Set<number>();
  for (const id of ms?.plates.keys() ?? []) ids.add(id);
  for (const id of si?.plates.keys() ?? []) ids.add(id);
  for (const id of gcodeByPlate.keys()) ids.add(id);
  for (const e of arc.find(RE_PLATE_PNG)) {
    const m = e.name.match(RE_PLATE_PNG);
    if (m) ids.add(Number(m[1]));
  }
  const plateIds = Array.from(ids).sort((a, b) => a - b);
  if (!plateIds.length) warnings.push({ code: 'no-plates' });

  // --- сборка пластин ----------------------------------------------------------
  const plates: ThreeMFPlate[] = [];
  for (const id of plateIds) {
    const meta = ms?.plates.get(id)?.meta ?? {};
    const rawSlice = si?.plates.get(id);

    const pathOf = (v: string | undefined) => {
      if (!v) return undefined;
      const p = norm(v);
      return arc.getEntry(p) ? p : undefined;
    };

    let gcodePath: string | undefined;
    const declared = meta.gcode_file ? norm(meta.gcode_file) : undefined;
    if (declared && arc.getEntry(declared)) {
      gcodePath = declared;
    } else if (relsGcode.has(`Metadata/plate_${id}.gcode`) && gcodeByPlate.get(id)) {
      gcodePath = gcodeByPlate.get(id);
    } else if (gcodeByPlate.get(id)) {
      gcodePath = gcodeByPlate.get(id);
    } else if (declared) {
      warnings.push({ code: 'plate-gcode-missing', plateId: id });
    }
    if (!gcodePath && hasGcode && gcodeByPlate.get(id)) gcodePath = gcodeByPlate.get(id);

    const slice: ThreeMFPlateSlice | undefined = rawSlice
      ? {
          predictionSec: rawSlice.meta.prediction !== undefined ? Number(rawSlice.meta.prediction) : undefined,
          weightG: parseLocaleFloat(rawSlice.meta.weight),
          firstLayerSec: parseLocaleFloat(rawSlice.meta.first_layer_time),
          supportUsed: parseBool(rawSlice.meta.support_used),
          labelObjectEnabled: parseBool(rawSlice.meta.label_object_enabled),
          nozzleDiameters: splitNums(rawSlice.meta.nozzle_diameters, ','),
          objects: rawSlice.objects,
          filaments: rawSlice.filaments,
        }
      : undefined;

    // Объекты: форма B (slice_info) авторитетнее; форма A — object/model_instance.
    let objects: ThreeMFPlateObject[] = slice?.objects ?? [];
    if (!objects.length && ms) {
      const raw = ms.plates.get(id);
      objects = (raw?.instanceObjectIds ?? [])
        .map((oid) => ms.objects.get(oid))
        .filter((o): o is { name: string; extruder?: number } => !!o)
        .map((o) => ({ name: o.name, extruder: o.extruder, skipped: false }));
    }

    const pjText = await read(`Metadata/plate_${id}.json`);
    let info: ThreeMFPlateInfo | undefined;
    if (pjText) {
      info = parsePlateJson(pjText) ?? undefined;
      if (!info) warnings.push({ code: 'plate-json-broken', plateId: id });
    }

    plates.push({
      id,
      name: meta.plater_name?.trim() || `Plate ${id}`,
      gcodePath,
      gcodeSize: gcodePath ? arc.getEntry(gcodePath)?.uncompressedSize : undefined,
      thumbnailPath: pathOf(meta.thumbnail_file),
      topPath: pathOf(meta.top_file),
      pickPath: pathOf(meta.pick_file),
      noLightPath: pathOf(meta.thumbnail_no_light_file),
      bboxPath: pathOf(meta.pattern_bbox_file),
      filamentSlots: splitNums(meta.filament_maps, ' ') ?? [],
      objects,
      slice,
      info,
    });
  }

  if (!hasGcode) warnings.push({ code: 'no-gcode' });
  else for (const p of plates) if (!p.gcodePath) warnings.push({ code: 'plate-gcode-missing', plateId: p.id });

  // --- филамент-слоты и принтер из project_settings ----------------------------
  const filamentSlots: ThreeMFFilamentSlot[] = [];
  const strArr = (k: string): string[] => (Array.isArray(project?.[k]) ? (project![k] as string[]) : []);
  const slotCount = Math.max(
    strArr('filament_type').length,
    strArr('filament_colour').length,
    strArr('filament_vendor').length,
    strArr('filament_settings_id').length,
    strArr('filament_ids').length,
  );
  for (let i = 0; i < slotCount; i++) {
    filamentSlots.push({
      slot: i + 1,
      type: strArr('filament_type')[i] || undefined,
      color: strArr('filament_colour')[i] || undefined,
      vendor: strArr('filament_vendor')[i] || undefined,
      profileId: strArr('filament_settings_id')[i] || undefined,
      filamentId: strArr('filament_ids')[i] || undefined,
    });
  }

  const printer = project
    ? {
        model: typeof project.printer_model === 'string' ? project.printer_model : undefined,
        printerProfile: typeof project.printer_settings_id === 'string' ? project.printer_settings_id : undefined,
        processProfile: typeof project.default_print_profile === 'string' ? project.default_print_profile : undefined,
        gcodeFlavor: typeof project.gcode_flavor === 'string' ? project.gcode_flavor : undefined,
        agent: typeof project.printer_agent === 'string' ? project.printer_agent : undefined,
      }
    : undefined;

  const inspection: ThreeMFInspection = {
    vendor,
    slicerVersion,
    hasGcode,
    plates,
    filamentSlots,
    printer,
    layerHeight: typeof project?.layer_height === 'string' ? parseLocaleFloat(project.layer_height) : undefined,
    coverPath,
    warnings,
  };

  // --- handle: ленивое извлечение частей ---------------------------------------
  async function extractBlob(path: string): Promise<Blob> {
    assertSafePath(path);
    const entry = arc.getEntry(path);
    if (!entry) throw new ZipError('no-entry', path);
    const bytes = await arc.readEntry(entry, opts.signal);
    return new Blob([bytes], { type: mimeFor(path) });
  }

  return {
    inspection,
    extractBlob,
    async plateThumbnail(plateId) {
      const plate = inspection.plates.find((p) => p.id === plateId);
      if (!plate?.thumbnailPath) return null;
      try {
        return await extractBlob(plate.thumbnailPath);
      } catch {
        return null;
      }
    },
    async plateGcode(plateId) {
      const plate = inspection.plates.find((p) => p.id === plateId);
      if (!plate?.gcodePath) throw new ZipError('no-gcode', `plate ${plateId}`);
      return extractBlob(plate.gcodePath);
    },
    close() {
      /* no-op: object URL создаёт и гасит потребитель */
    },
  };
}