import { beforeEach, describe, expect, it, vi } from 'vitest';

// Каталог при импорте сразу читает /extensions/index.json: здесь нужен только URL-хелпер.
vi.mock('../extensions-catalog.svelte.ts', () => ({
  absoluteManifestUrl: (u: string) => `http://printer:8000${u}`,
}));

import {
  createExtensionsInstaller,
  findHostPrinter,
  type RegistryPlugin,
} from '../extensions-installer.svelte.ts';

const MANIFEST = '/extensions/hello/manifest.json';
const ABSOLUTE = `http://printer:8000${MANIFEST}`;

const plugin: RegistryPlugin = {
  id: 'acme/hello',
  name: 'Hello',
  version: '1.0.0',
  installedVersion: null,
  state: 'available',
  description: '',
  managed: false,
  manifestUrl: MANIFEST,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(respond: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const order: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace('/tessera-api/v1/', '');
    order.push(`api:${path}`);
    return respond(path, init ?? {});
  });
  const settings = {
    plugins: [] as Array<{ manifestUrl: string }>,
    addPlugin: vi.fn(() => order.push('settings:add')),
    removePlugin: vi.fn(() => order.push('settings:remove')),
  };
  const catalog = { refresh: vi.fn(async () => void order.push('catalog')) };
  const loader = {
    loadEnabledPlugins: vi.fn(async () => void order.push('loader:load')),
    reloadRemotePlugin: vi.fn(async () => void order.push('loader:reload')),
  };
  let token: string | null = null;
  const installer = createExtensionsInstaller({
    getToken: () => token,
    catalog,
    settings,
    loader,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return {
    installer,
    settings,
    catalog,
    loader,
    fetchMock,
    order,
    setToken: (t: string | null) => {
      token = t;
    },
  };
}

const okStatus = () => json(200, { plugins: [plugin], registryError: null });
const okAction = (extra: object = {}) =>
  json(200, { id: plugin.id, changed: true, version: '1.0.0', manifestUrl: MANIFEST, ...extra });

describe('extensions-installer / availability', () => {
  it('служба ответила: блок доступен', async () => {
    const { installer } = setup(okStatus);
    await installer.refresh();
    expect(installer.available).toBe(true);
    expect(installer.plugins).toEqual([plugin]);
  });

  it.each([
    ['404 от nginx', () => new Response('<html>', { status: 404 })],
    ['502 без службы', () => new Response('<html>', { status: 502 })],
    ['HTML от dev-сервера', () => new Response('<!doctype html>', { status: 200 })],
    ['JSON без поля error', () => json(500, {})],
  ])('%s: блок скрыт', async (_name, respond) => {
    const { installer } = setup(respond);
    await installer.refresh();
    expect(installer.available).toBe(false);
    expect(installer.error).toBeNull();
  });

  it('сетевая ошибка: блок скрыт', async () => {
    const { installer } = setup(() => {
      throw new TypeError('network');
    });
    await installer.refresh();
    expect(installer.available).toBe(false);
  });

  it('401: служба есть, причина видна', async () => {
    const { installer } = setup(() => json(401, { error: 'Unauthorized: log in to this printer' }));
    await installer.refresh();
    expect(installer.available).toBe(true);
    expect(installer.plugins).toEqual([]);
    expect(installer.error?.status).toBe(401);
  });

  it('реестр недоступен: установленные всё равно показаны', async () => {
    const { installer } = setup(() => json(200, { plugins: [plugin], registryError: 'HTTP 500' }));
    await installer.refresh();
    expect(installer.registryError).toBe('HTTP 500');
    expect(installer.plugins).toHaveLength(1);
  });
});

describe('extensions-installer / requests', () => {
  it('токен уходит в Authorization, без токена заголовка нет', async () => {
    const { installer, fetchMock, setToken } = setup(okStatus);
    await installer.refresh();
    expect((fetchMock.mock.calls[0]![1]?.headers as Record<string, string>).Authorization).toBeUndefined();

    setToken('jwt');
    await installer.refresh();
    expect((fetchMock.mock.calls[1]![1]?.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });

  it('действие передаёт JSON только с id', async () => {
    const { installer, fetchMock } = setup((path) => (path === 'status' ? okStatus() : okAction()));
    await installer.install(plugin);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ id: 'acme/hello' });
  });
});

describe('extensions-installer / install', () => {
  it('файлы → каталог → enablement → загрузка', async () => {
    const { installer, settings, order } = setup((path) => (path === 'status' ? okStatus() : okAction()));
    await expect(installer.install(plugin)).resolves.toBe(true);
    expect(order).toEqual(['api:install', 'catalog', 'settings:add', 'loader:load', 'catalog', 'api:status']);
    expect(settings.addPlugin).toHaveBeenCalledWith(ABSOLUTE, [], 'catalog', '1.0.0');
    expect(installer.busyId).toBeNull();
  });

  it('отказ службы: enablement не меняется, ошибка видна, каталог перечитан', async () => {
    const { installer, settings, loader, catalog } = setup((path) =>
      path === 'status' ? okStatus() : json(400, { error: 'sha256 mismatch' }),
    );
    await expect(installer.install(plugin)).resolves.toBe(false);
    expect(installer.error?.message).toBe('sha256 mismatch');
    expect(settings.addPlugin).not.toHaveBeenCalled();
    expect(loader.loadEnabledPlugins).not.toHaveBeenCalled();
    expect(catalog.refresh).toHaveBeenCalled();
    expect(installer.busyId).toBeNull();
  });

  it('второе действие во время первого не запускается', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { installer, fetchMock } = setup(async (path) => {
      if (path === 'status') return okStatus();
      await gate;
      return okAction();
    });
    const first = installer.install(plugin);
    await expect(installer.install(plugin)).resolves.toBe(false);
    expect(installer.busyId).toBe(plugin.id);
    release();
    await first;
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('install'))).toHaveLength(1);
  });
});

describe('extensions-installer / update', () => {
  it('плагин включён в этом браузере: перезагрузка манифеста и плашка', async () => {
    const { installer, settings, loader } = setup((path) => (path === 'status' ? okStatus() : okAction()));
    settings.plugins = [{ manifestUrl: ABSOLUTE }];
    await expect(installer.update(plugin)).resolves.toBe(true);
    expect(loader.reloadRemotePlugin).toHaveBeenCalledWith(ABSOLUTE);
  });

  it('не включён в этом браузере: только файлы', async () => {
    const { installer, loader } = setup((path) => (path === 'status' ? okStatus() : okAction()));
    await expect(installer.update(plugin)).resolves.toBe(false);
    expect(loader.reloadRemotePlugin).not.toHaveBeenCalled();
  });

  it('версия не изменилась: перезагружать нечего', async () => {
    const { installer, settings, loader } = setup((path) =>
      path === 'status' ? okStatus() : okAction({ changed: false }),
    );
    settings.plugins = [{ manifestUrl: ABSOLUTE }];
    await expect(installer.update(plugin)).resolves.toBe(false);
    expect(loader.reloadRemotePlugin).not.toHaveBeenCalled();
  });
});

describe('extensions-installer / remove', () => {
  it('сначала файлы, затем enablement', async () => {
    const { installer, settings, order } = setup((path) =>
      path === 'status' ? okStatus() : json(200, { id: plugin.id, changed: true }),
    );
    await expect(installer.remove(plugin)).resolves.toBe(true);
    expect(order).toEqual(['api:remove', 'settings:remove', 'loader:load', 'catalog', 'api:status']);
    expect(settings.removePlugin).toHaveBeenCalledWith(ABSOLUTE);
  });

  it('отказ службы: запись в браузере остаётся', async () => {
    const { installer, settings } = setup((path) =>
      path === 'status' ? okStatus() : json(409, { error: 'installed manually' }),
    );
    await expect(installer.remove(plugin)).resolves.toBe(false);
    expect(settings.removePlugin).not.toHaveBeenCalled();
    expect(installer.error?.status).toBe(409);
  });
});

describe('findHostPrinter', () => {
  const location = { origin: 'http://printer:8000', hostname: 'printer' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('запись по умолчанию: тот же hostname, порт Moonraker', () => {
    const local = { id: 'a', url: 'http://printer:7125' };
    expect(findHostPrinter([{ id: 'b', url: 'http://other:7125' }, local], location)).toBe(local);
  });

  it('совпадение origin важнее совпадения hostname', () => {
    const direct = { id: 'a', url: 'http://printer:7125' };
    const proxied = { id: 'b', url: 'http://printer:8000' };
    expect(findHostPrinter([direct, proxied], location)).toBe(proxied);
  });

  it('только чужие принтеры и битый URL: null', () => {
    expect(findHostPrinter([{ id: 'a', url: 'http://other:7125' }, { id: 'b', url: 'not a url' }], location)).toBeNull();
  });
});

describe('extensions-installer / additional registries', () => {
  const official: RegistryPlugin = { ...plugin, source: 'official' };
  const mine: RegistryPlugin = { ...plugin, version: '7.0.0', source: 'mine' };
  const sources = [
    { name: 'official', url: 'https://raw.example/official.json', official: true, plugins: 1, error: null },
    { name: 'mine', url: 'https://mine.example/registry.json', official: false, plugins: 1, error: null },
  ];
  const statusWith = (plugins: RegistryPlugin[]) => () => json(200, { plugins, registryError: null, sources });

  it('keeps the registries of the service', async () => {
    const { installer } = setup(statusWith([official, mine]));
    await installer.refresh();
    expect(installer.sources).toEqual(sources);
  });

  it('an older service has no registries: sources stay null so the UI hides them', async () => {
    const { installer } = setup(okStatus);
    await installer.refresh();
    expect(installer.sources).toBeNull();
  });

  it('names the registry in install and update requests, never an address', async () => {
    const { installer, fetchMock } = setup((path) => (path === 'status' ? statusWith([official, mine])() : okAction()));
    await installer.install(mine);
    await installer.update(mine);
    const bodies = fetchMock.mock.calls
      .filter(([url]) => !String(url).endsWith('status'))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toEqual([
      { id: 'acme/hello', source: 'mine' },
      { id: 'acme/hello', source: 'mine' },
    ]);
  });

  it('the same id from two registries is two rows: the busy marker tells them apart', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { installer } = setup(async (path) => {
      if (path === 'status') return statusWith([official, mine])();
      await gate;
      return okAction();
    });
    const running = installer.install(mine);
    expect(installer.busyId).toBe('mine:acme/hello');
    release();
    await running;
  });

  it('adds a registry by address, with an optional name, then rereads the status', async () => {
    const { installer, fetchMock } = setup((path) =>
      path === 'status' ? statusWith([official])() : json(200, { changed: true, name: 'mine', plugins: 1 }),
    );
    await expect(installer.addSource('https://mine.example/registry.json', 'mine')).resolves.toBe(true);
    await expect(installer.addSource('https://other.example/r.json')).resolves.toBe(true);
    const adds = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('repo-add')).map(([, i]) => JSON.parse(String(i?.body)));
    expect(adds).toEqual([{ url: 'https://mine.example/registry.json', name: 'mine' }, { url: 'https://other.example/r.json' }]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('status'))).toHaveLength(2);
    expect(installer.busyId).toBeNull();
  });

  it('a refused registry is reported and nothing else changes', async () => {
    const { installer, settings } = setup((path) =>
      path === 'status' ? statusWith([official])() : json(400, { error: 'A registry address must start with https://' }),
    );
    await expect(installer.addSource('http://x.example/r.json')).resolves.toBe(false);
    expect(installer.error?.message).toContain('https://');
    expect(settings.addPlugin).not.toHaveBeenCalled();
  });

  it('removes a registry by name', async () => {
    const { installer, fetchMock } = setup((path) =>
      path === 'status' ? statusWith([official])() : json(200, { changed: true, name: 'mine', orphaned: [] }),
    );
    await expect(installer.removeSource('mine')).resolves.toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'mine' });
  });

  it('dependencies come from the same registry, then the built-in one, never a third', async () => {
    const dep = (source: string, state: RegistryPlugin['state'] = 'available'): RegistryPlugin => ({
      ...plugin,
      id: 'acme/owner',
      name: `Owner@${source}`,
      source,
      state,
      manifestUrl: `/extensions/owner-${source}/manifest.json`,
    });
    const addon: RegistryPlugin = { ...plugin, id: 'acme/addon', name: 'Addon', source: 'mine', requires: ['acme/owner', 'acme/third'] };
    const third: RegistryPlugin = { ...plugin, id: 'acme/third', name: 'Third', source: 'other' };
    const { installer } = setup(statusWith([dep('official'), dep('mine'), addon, third]));
    await installer.refresh();

    const deps = installer.dependenciesOf(addon);
    expect(deps.install.map((d) => d.name)).toEqual(['Owner@mine']);
    expect(deps.missing).toEqual(['acme/third']);
  });

  it('an entry blocked by another registry is not a dependency candidate', async () => {
    const blocked: RegistryPlugin = { ...plugin, id: 'acme/owner', source: 'official', state: 'conflict' };
    const addon: RegistryPlugin = { ...plugin, id: 'acme/addon', source: 'official', requires: ['acme/owner'] };
    const { installer } = setup(statusWith([blocked, addon]));
    await installer.refresh();
    expect(installer.dependenciesOf(addon).missing).toEqual(['acme/owner']);
  });
});
