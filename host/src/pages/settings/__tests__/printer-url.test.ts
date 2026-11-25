import { describe, expect, it } from 'vitest';

import { normalizePrinterUrl } from '../printer-url';

// These cases protect the URL that both dialog actions pass to Moonraker.
describe('normalizePrinterUrl', () => {
  it.each([
    ['192.168.1.20', 'http://192.168.1.20:7125'],
    ['192.168.1.20:7130', 'http://192.168.1.20:7130'],
    ['http://192.168.1.20:7125/', 'http://192.168.1.20:7125'],
    ['https://printer.local/', 'https://printer.local'],
    ['https://printer.local:8443/', 'https://printer.local:8443'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePrinterUrl(input)).toBe(expected);
  });

  it.each(['', 'https://', 'ftp://printer.local', 'printer.local/path', 'https://printer.local?token=1'])('rejects %s', (input) => {
    expect(normalizePrinterUrl(input)).toBeNull();
  });
});
