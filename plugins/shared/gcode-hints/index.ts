export type {
  Catalog,
  CommandInfo,
  CommandDoc,
  GcodeDocs,
  ParamInfo,
  ValueKind,
} from './types';
export { parseGcodeDocs, parseUsage } from './gcode-docs';
export {
  buildCatalog,
  mergeLocalMacros,
  letterSignature,
  namedParams,
  paramTypeLabel,
} from './catalog';
export { scanLocalMacros, macroParamNamesAt, type MacroSource } from './local-macros';
export {
  suggestForLine,
  completionTokenStart,
  type HintSuggestion,
  type HintResult,
  type SuggestOptions,
} from './suggest';
export {
  attachHints,
  dropHints,
  getCatalog,
  hasDocs,
  parseMacroSections,
} from './gcode-hints-store.svelte.ts';
