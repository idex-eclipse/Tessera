import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SURFACE_SPECS } from '../../../host/src/core/surfaces';
import { FILE_TABLE_POINT_IDS, fileTablePoints } from '../file-table/extension-points';

const FILE_TABLE_SRC = readFileSync(join(__dirname, '..', 'file-table', 'FileTable.svelte'), 'utf8');

describe('shared FileTable extension points', () => {
  it('declares valid points with the given title prefix', () => {
    const validate = SURFACE_SPECS.extensionPoints.validate!;
    const points = fileTablePoints('acme');
    for (const p of points) {
      expect(validate(p), p.id).toBe(true);
      expect(p.titleKey).toMatch(/^acme\.ext\./);
    }
    expect(points.map((p) => p.id).sort()).toEqual(Object.values(FILE_TABLE_POINT_IDS).sort());
  });

  // The ids are shared constants, so FileTable.svelte must reference each of them, otherwise a point is dead API.
  it('FileTable.svelte uses every declared point', () => {
    for (const key of Object.keys(FILE_TABLE_POINT_IDS)) {
      expect(FILE_TABLE_SRC, key).toContain(`FILE_TABLE_POINT_IDS.${key}`);
    }
  });

  it('keeps the dialogs replacement-only and the file actions append-only', () => {
    const byId = new Map(fileTablePoints('acme').map((p) => [p.id, p]));
    expect(byId.get(FILE_TABLE_POINT_IDS.actions)).toMatchObject({ kind: 'action', mode: 'append' });
    expect(byId.get(FILE_TABLE_POINT_IDS.editor)).toMatchObject({ kind: 'element', mode: 'replacement' });
    expect(byId.get(FILE_TABLE_POINT_IDS.viewer)).toMatchObject({ kind: 'element', mode: 'replacement' });
  });
});
