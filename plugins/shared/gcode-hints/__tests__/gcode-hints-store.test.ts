import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../../../../plugin-sdk/src/types';
import { clearDocCache } from '../doc-source';
import {
  attachHints,
  dropHints,
  getCatalog,
  hasDocs,
  parseMacroSections,
} from '../gcode-hints-store.svelte.ts';

const DOCS = [
  '# G-Codes',
  '## Additional Commands',
  '### [output_pin]',
  '#### SET_PIN',
  '`SET_PIN PIN=config_name VALUE=<value>`: Set the pin.',
  '',
].join('\n');

interface FakeHandle {
  request: ReturnType<typeof vi.fn>;
  onReady: ReturnType<typeof vi.fn>;
  onNotify: ReturnType<typeof vi.fn>;
  httpBaseUrl: string;
  authToken: string | null;
  fire(event: string): void;
  fireReady(): void;
  offReady: ReturnType<typeof vi.fn>;
  offNotify: ReturnType<typeof vi.fn>;
}

function makeHandle(): FakeHandle {
  const notify = new Map<string, () => void>();
  let ready: (() => void) | null = null;
  const offReady = vi.fn();
  const offNotify = vi.fn();
  const h: FakeHandle = {
    httpBaseUrl: 'http://pr:7125',
    authToken: null,
    request: vi.fn(async (method: string) => {
      if (method === 'printer.gcode.help') return { SET_PIN: 'Set the value of an output pin', MY_MACRO: 'Hello' };
      if (method === 'printer.objects.query') {
        return {
          status: {
            configfile: {
              config: {
                'gcode_macro MY_MACRO': { gcode: '{% set x = params.X|int %}', description: 'Hello' },
                'stepper_x': {},
              },
              settings: { 'gcode_macro my_macro': { gcode: 'M117', description: 'G-Code macro' } },
            },
          },
        };
      }
      return null;
    }),
    onReady: vi.fn((cb: () => void) => {
      ready = cb;
      return offReady;
    }),
    onNotify: vi.fn((ev: string, cb: () => void) => {
      notify.set(ev, cb);
      return offNotify;
    }),
    fire: (ev) => notify.get(ev)?.(),
    fireReady: () => ready?.(),
    offReady,
    offNotify,
  };
  return h;
}

function fakeApi(handle: FakeHandle): PluginApi {
  return { moonrakerFor: () => handle } as unknown as PluginApi;
}

const ok = (body: string) => Promise.resolve({ ok: true, status: 200, text: async () => body });
const http = (status: number) => Promise.resolve({ ok: false, status, text: async () => '' });

let n = 0;
const nextId = () => `p${++n}`;

beforeEach(() => clearDocCache());
afterEach(() => vi.unstubAllGlobals());

describe('parseMacroSections', () => {
  it('config приоритетнее settings, имена без учёта регистра, не-макросы пропускаются', () => {
    const macros = parseMacroSections({
      config: {
        'gcode_macro Start': { gcode: '{params.BED|float}', description: 'Go' },
        stepper_x: {},
      },
      settings: {
        'gcode_macro start': { gcode: 'M117', description: 'G-Code macro' },
        'gcode_macro other': { gcode: 'G28' },
      },
    });
    expect(macros.map((m) => m.name)).toEqual(['Start', 'other']);
    expect(macros[0]).toMatchObject({ description: 'Go' });
    expect(macros[0]!.params.map((p) => p.name)).toEqual(['BED']);
    expect(macros[1]!.params).toEqual([]);
  });

  it('мусор на входе не роняет разбор', () => {
    expect(parseMacroSections(null)).toEqual([]);
    expect(parseMacroSections({ config: { 'gcode_macro x': null } })).toEqual([
      { name: 'x', description: '', params: [] },
    ]);
  });
});

describe('attachHints', () => {
  it('грузит help, макросы и G-Codes.md; каталог их объединяет', async () => {
    const pid = nextId();
    const h = makeHandle();
    vi.stubGlobal('fetch', vi.fn(() => ok(DOCS)));
    const detach = attachHints(fakeApi(h), pid);

    await vi.waitFor(() => expect(hasDocs(pid)).toBe(true));
    const c = getCatalog(pid);
    expect(c.get('SET_PIN')).toMatchObject({ kind: 'extended', module: 'output_pin' });
    expect(c.get('SET_PIN')?.params.map((p) => p.name)).toEqual(['PIN', 'VALUE']);
    expect(c.get('MY_MACRO')).toMatchObject({ kind: 'macro', description: 'Hello' });
    expect(c.get('MY_MACRO')?.params.map((p) => p.name)).toEqual(['X']);
    expect(c.has('G28')).toBe(true); // стандартные — всегда

    detach();
    dropHints(pid);
  });

  it('счётчик потребителей: подписки снимаются только с последним', () => {
    const pid = nextId();
    const h = makeHandle();
    vi.stubGlobal('fetch', vi.fn(() => http(404)));
    const api = fakeApi(h);
    const a = attachHints(api, pid);
    const b = attachHints(api, pid);
    expect(h.onReady).toHaveBeenCalledTimes(1);
    expect(h.onNotify).toHaveBeenCalledTimes(1);

    a();
    a(); // повторный вызов не считается
    expect(h.offReady).not.toHaveBeenCalled();
    b();
    expect(h.offReady).toHaveBeenCalledTimes(1);
    expect(h.offNotify).toHaveBeenCalledTimes(1);
    dropHints(pid);
  });

  it('notify_config_changed перечитывает help и макросы, документ — нет', async () => {
    const pid = nextId();
    const h = makeHandle();
    const fetchMock = vi.fn(() => ok(DOCS));
    vi.stubGlobal('fetch', fetchMock);
    const detach = attachHints(fakeApi(h), pid);
    await vi.waitFor(() => expect(hasDocs(pid)).toBe(true));

    const helpCalls = () => h.request.mock.calls.filter((c) => c[0] === 'printer.gcode.help').length;
    const before = helpCalls();
    h.fire('notify_config_changed');
    await vi.waitFor(() => expect(helpCalls()).toBe(before + 1));
    h.fireReady();
    await vi.waitFor(() => expect(helpCalls()).toBe(before + 2));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    detach();
    dropHints(pid);
  });

  it('G-Codes.md недоступен: остаются help, макросы и запасная таблица; повтор по onReady', async () => {
    const pid = nextId();
    const h = makeHandle();
    let docsStatus = 404;
    vi.stubGlobal('fetch', vi.fn(() => (docsStatus === 200 ? ok(DOCS) : http(docsStatus))));
    const detach = attachHints(fakeApi(h), pid);

    await vi.waitFor(() => expect(getCatalog(pid).has('SET_PIN')).toBe(true));
    expect(hasDocs(pid)).toBe(false);
    expect(getCatalog(pid).get('SET_PIN')?.params).toEqual([]); // без docs параметров нет
    expect(getCatalog(pid).has('G1')).toBe(true);

    docsStatus = 200;
    h.fireReady();
    await vi.waitFor(() => expect(hasDocs(pid)).toBe(true));
    expect(getCatalog(pid).get('SET_PIN')?.params.map((p) => p.name)).toEqual(['PIN', 'VALUE']);

    detach();
    dropHints(pid);
  });

  it('принтер без соединения (moonrakerFor бросает) — пустая отписка, без исключений', () => {
    const api = {
      moonrakerFor: () => {
        throw new Error('no printer');
      },
    } as unknown as PluginApi;
    expect(() => attachHints(api, nextId())()).not.toThrow();
  });

  it('getCatalog мемоизирован: без изменений данных возвращает тот же объект', async () => {
    const pid = nextId();
    const h = makeHandle();
    vi.stubGlobal('fetch', vi.fn(() => ok(DOCS)));
    const detach = attachHints(fakeApi(h), pid);
    await vi.waitFor(() => expect(hasDocs(pid)).toBe(true));
    expect(getCatalog(pid)).toBe(getCatalog(pid));
    detach();
    dropHints(pid);
  });
});
