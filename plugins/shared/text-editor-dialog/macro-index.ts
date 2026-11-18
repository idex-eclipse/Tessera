import type { MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import type { FileRef } from '../file-table/file-ops';

/** A source definition with an exact range, file location, and include status. */
export interface MacroDefinition {
  name: string;
  path: string;
  from: number;
  to: number;
  firstLine: number;
  lastLine: number;
  active: boolean;
}

/** A literal call token and its source range for placing a peek after its line. */
export interface MacroCall {
  name: string;
  from: number;
  to: number;
  lineEnd: number;
}

const HEADER = /^[ \t]*\[\s*gcode_macro\s+([^\]\s]+)\s*\]/i;
const INCLUDE = /^[ \t]*\[\s*include\s+([^\]]+)\]/i;

/** Scan exact macro section offsets in `text` from `path`; return definitions in source order. */
export function scanMacroDefinitions(text: string, path: string): MacroDefinition[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const result: MacroDefinition[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = HEADER.exec(lines[i] ?? '');
    if (!match) continue;
    let endLine = i + 1;
    while (endLine < lines.length && !/^[ \t]*\[/.test(lines[endLine] ?? '')) endLine++;
    result.push({
      name: match[1] ?? '', path, from: starts[i] ?? 0,
      to: endLine < lines.length ? starts[endLine] ?? text.length : text.length,
      firstLine: i + 1, lastLine: endLine, active: false,
    });
  }
  return result;
}

/** Locate a definition in `text` and keep the next section on a separate line after a peek edit. */
export function macroSectionEdit(
  text: string, definition: MacroDefinition, section: string,
): { from: number; to: number; insert: string } | null {
  const matches = scanMacroDefinitions(text, definition.path);
  const current = matches.find((item) => item.firstLine === definition.firstLine &&
    item.name.toUpperCase() === definition.name.toUpperCase())
    ?? matches.find((item) => item.name.toUpperCase() === definition.name.toUpperCase());
  if (!current) return null;
  // CodeMirror may auto-indent after Enter at the end of a peek; the next header must stay at column zero.
  const insert = current.to < text.length && !section.endsWith('\n') ? `${section}\n` : section;
  return { from: current.from, to: current.to, insert };
}

/** Find a literal call at `offset` in any section's `gcode:` body when its name is in `names`. */
export function macroCallAt(text: string, offset: number, names: ReadonlySet<string>): MacroCall | null {
  const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const lineEndAt = text.indexOf('\n', offset);
  const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;
  const line = text.slice(lineStart, lineEnd);
  // A top-level option after gcode, such as `axes: xyz`, is not a command call.
  if (/^[A-Za-z_][A-Za-z0-9_]*[ \t]*[:=]/.test(line)) return null;
  // Klipper also runs macro calls from homing_override and delayed_gcode sections.
  const before = text.slice(0, lineStart);
  const sections = [...before.matchAll(/^[ \t]*\[[^\]\r\n]+\]/gm)];
  const section = sections.at(-1);
  if (!section || section.index === undefined) return null;
  const sectionText = before.slice(section.index + section[0].length);
  const gcodeOptions = [...sectionText.matchAll(/^[ \t]*gcode[ \t]*[:=][ \t]*(?:[;#].*)?$/gmi)];
  const gcode = gcodeOptions.at(-1);
  if (!gcode || gcode.index === undefined) return null;
  // A later top-level option ends the gcode value even without another section.
  if (/^[A-Za-z_][A-Za-z0-9_]*[ \t]*[:=]/m.test(sectionText.slice(gcode.index + gcode[0].length))) return null;
  // A Jinja control tag may precede a literal command on the same line.
  const match = /^([ \t]*(?:\{%-?[^\n]*?-?%\}[ \t]*)*)([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
  if (!match) return null;
  const from = lineStart + (match[1]?.length ?? 0);
  const to = from + (match[2]?.length ?? 0);
  const name = match[2] ?? '';
  return offset >= from && offset <= to && names.has(name.toUpperCase())
    ? { name, from, to, lineEnd } : null;
}

function globRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // A recursive include also matches files directly in its starting directory.
    .replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:.*/)?').replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function resolveInclude(baseDir: string, pattern: string): string | null {
  const parts: string[] = [];
  for (const segment of `${baseDir}${pattern}`.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(segment);
  }
  return parts.join('/');
}

/** Traverse include masks in `files` from printer.cfg; return paths active in that graph. */
export function activeConfigPaths(files: ReadonlyMap<string, string>): Set<string> {
  const paths = [...files.keys()];
  const active = new Set<string>();
  const visit = (path: string): void => {
    if (active.has(path)) return;
    const text = files.get(path);
    if (text === undefined) return;
    active.add(path);
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    for (const line of text.split('\n')) {
      const match = INCLUDE.exec(line);
      if (!match) continue;
      const pattern = resolveInclude(dir, (match[1] ?? '').trim());
      if (!pattern) continue;
      const re = globRegex(pattern);
      for (const candidate of paths) if (re.test(candidate)) visit(candidate);
    }
  };
  visit('printer.cfg');
  return active;
}

/** Read every config .cfg through `target`, overlay `buffers`, and return files and definitions. */
export async function loadMacroIndex(
  target: MoonrakerProxyHandle,
  readText: (ref: FileRef, target: MoonrakerProxyHandle) => Promise<string>,
  buffers: ReadonlyMap<string, string>,
): Promise<{ files: Map<string, string>; definitions: MacroDefinition[] }> {
  const files = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    const response = await target.request<{
      dirs?: Array<{ dirname?: string }>;
      files?: Array<{ filename?: string }>;
    }>('server.files.get_directory', { path: `config${dir ? `/${dir}` : ''}` });
    for (const file of response.files ?? []) {
      const name = file.filename ?? '';
      if (!/\.cfg$/i.test(name)) continue;
      const path = dir ? `${dir}/${name}` : name;
      const text = buffers.get(path) ?? await readText({ root: 'config', path, isDir: false }, target);
      files.set(path, text.replace(/\r\n?/g, '\n'));
    }
    for (const child of response.dirs ?? []) {
      const name = child.dirname ?? '';
      if (!name || name === '.backup' || name === '.' || name === '..') continue;
      await walk(dir ? `${dir}/${name}` : name);
    }
  };
  await walk('');
  for (const [path, text] of buffers) if (/\.cfg$/i.test(path)) files.set(path, text);
  const active = activeConfigPaths(files);
  const definitions = [...files].flatMap(([path, text]) =>
    scanMacroDefinitions(text, path).map((item) => ({ ...item, active: active.has(path) })));
  return { files, definitions };
}
