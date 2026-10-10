/** Хардкод-каталог стандартных G/M-команд: сигнатура параметров + ключ
 *  локализованного описания. Описание уступает строке из printer.gcode.help,
 *  если команда есть в списке Moonraker (приоритет источника). */
export interface BuiltinGcode {
  name: string;
  params: string;   // сигнатура без скобок: 'X Y Z E F'
  descKey: string;  // i18n-ключ console.gcode.*
}

export const BUILTIN_GCODE: BuiltinGcode[] = [
  { name: 'G0', params: 'X Y Z E F', descKey: 'console.gcode.move' },
  { name: 'G1', params: 'X Y Z E F', descKey: 'console.gcode.move' },
  { name: 'G2', params: 'X Y I J E F', descKey: 'console.gcode.arcCw' },
  { name: 'G3', params: 'X Y I J E F', descKey: 'console.gcode.arcCcw' },
  { name: 'G4', params: 'P S', descKey: 'console.gcode.dwell' },
  { name: 'G28', params: 'X Y Z', descKey: 'console.gcode.home' },
  { name: 'G90', params: '', descKey: 'console.gcode.abs' },
  { name: 'G91', params: '', descKey: 'console.gcode.rel' },
  { name: 'G92', params: 'X Y Z E', descKey: 'console.gcode.setPosition' },
  { name: 'M82', params: '', descKey: 'console.gcode.eAbs' },
  { name: 'M83', params: '', descKey: 'console.gcode.eRel' },
  { name: 'M84', params: '', descKey: 'console.gcode.motorsOff' },
  { name: 'M104', params: 'S T', descKey: 'console.gcode.extTemp' },
  { name: 'M109', params: 'S T', descKey: 'console.gcode.extTempWait' },
  { name: 'M140', params: 'S', descKey: 'console.gcode.bedTemp' },
  { name: 'M190', params: 'S', descKey: 'console.gcode.bedTempWait' },
  { name: 'M106', params: 'S', descKey: 'console.gcode.fanOn' },
  { name: 'M107', params: '', descKey: 'console.gcode.fanOff' },
  { name: 'M117', params: '', descKey: 'console.gcode.lcdMessage' },
  { name: 'M220', params: 'S', descKey: 'console.gcode.speedFactor' },
  { name: 'M221', params: 'S', descKey: 'console.gcode.flowFactor' },
  { name: 'M400', params: '', descKey: 'console.gcode.waitMoves' },
];

export interface BuiltinHelp {
  params: string;
  help: string;
}

/** Собрать словарь для автодополнения: имя → {сигнатура, локализованный fallback-текст}. */
export function buildBuiltins(t: (key: string) => string): Record<string, BuiltinHelp> {
  const out: Record<string, BuiltinHelp> = {};
  for (const b of BUILTIN_GCODE) {
    out[b.name] = { params: b.params, help: t(b.descKey) };
  }
  return out;
}