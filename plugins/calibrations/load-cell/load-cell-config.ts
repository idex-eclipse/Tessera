/**
 * Which Klipper sections count as a load cell probe.
 *
 * Only `[load_cell_probe]` is a probe for the Probe page. A plain `[load_cell]` says
 * nothing about probing and is deliberately ignored here.
 */

export interface LoadCellProbeInfo {
  /** Config section, e.g. `load_cell_probe` or `load_cell_probe foo`. */
  section: string;
  /** Name used as the stream parameter: the last word of the section. */
  name: string;
}

const PROBE_SECTION = /^load_cell_probe(\s|$)/i;

/**
 * Stream name of a section: `load_cell_probe` → `load_cell_probe`, `load_cell_probe foo` → `foo`.
 * Not confirmed on hardware (the Klipper docs do not state it), hence one function to fix.
 */
export function loadCellProbeName(section: string): string {
  const words = section.trim().split(/\s+/);
  return words[words.length - 1]!;
}

/** Picks the `[load_cell_probe]` sections out of `configfile.settings` keys. */
export function findLoadCellProbes(sectionNames: readonly string[]): LoadCellProbeInfo[] {
  return sectionNames
    .filter((k) => PROBE_SECTION.test(k))
    .map((section) => ({ section, name: loadCellProbeName(section) }));
}
