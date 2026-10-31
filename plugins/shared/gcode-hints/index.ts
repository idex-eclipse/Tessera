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
  buildObjectIndex,
  mergeObjectIndex,
  scanSectionNames,
  resolveNames,
  makeNameResolver,
  quoteValue,
  jinjaObjectNames,
  macroVariables,
  printerRef,
  type ObjectIndex,
  type NameResolver,
  type NameCandidate,
  type ResolvedNames,
} from './object-names';
export {
  attachHints,
  dropHints,
  getCatalog,
  getObjects,
  hasDocs,
  parseMacroSections,
  parseSectionNames,
} from './gcode-hints-store.svelte.ts';
