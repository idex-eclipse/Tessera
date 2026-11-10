import { describe, expect, it } from 'vitest';

import { LEGACY_PLUGIN_API, PLUGIN_API, checkPluginApi, formatPluginApi, parsePluginApi } from '../api-level';

describe('plugin API version', () => {
  it('parses MAJOR.MINOR, the legacy forms and nothing else', () => {
    expect(parsePluginApi('0.8')).toEqual([0, 8]);
    expect(parsePluginApi('12.30')).toEqual([12, 30]);
    expect(parsePluginApi(undefined)).toEqual([0, 7]);
    expect(parsePluginApi(1)).toEqual([0, 7]);
    for (const bad of ['0.8.0', '1', '08.1', '0.08', 'latest', '', ' 0.8', 2, 0.8, null, true]) {
      expect(parsePluginApi(bad), String(bad)).toBeNull();
    }
  });

  it('needs the same MAJOR and a MINOR not above the host', () => {
    expect(checkPluginApi('0.7', '0.8')).toBe('ok');
    expect(checkPluginApi('0.8', '0.8')).toBe('ok');
    expect(checkPluginApi(undefined, '0.8')).toBe('ok');
    expect(checkPluginApi(1, '0.8')).toBe('ok');
    expect(checkPluginApi('0.9', '0.8')).toBe('newer');
    expect(checkPluginApi('1.0', '0.8')).toBe('major');
    expect(checkPluginApi('0.8', '1.0')).toBe('ok');
    expect(checkPluginApi('0.14', '1.0')).toBe('ok');
    expect(checkPluginApi('0.6', '1.0')).toBe('major');
    expect(checkPluginApi('0.15', '1.0')).toBe('newer');
    expect(checkPluginApi('0.14', '1.1')).toBe('major');
    expect(checkPluginApi('1.1', '1.0')).toBe('newer');
    expect(checkPluginApi('x', '0.8')).toBe('invalid');
  });

  it('compares MINOR numerically: 0.10 is newer than 0.9', () => {
    expect(checkPluginApi('0.10', '0.9')).toBe('newer');
    expect(checkPluginApi('0.9', '0.10')).toBe('ok');
    expect(checkPluginApi('0.10', '0.10')).toBe('ok');
  });

  it('the host version is valid and not below the legacy one', () => {
    expect(parsePluginApi(PLUGIN_API)).not.toBeNull();
    expect(checkPluginApi(LEGACY_PLUGIN_API)).toBe('ok');
    expect(formatPluginApi(undefined)).toBe('0.7');
    expect(formatPluginApi('nope')).toBe('nope');
  });
});
