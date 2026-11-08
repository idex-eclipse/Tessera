import type { MoonrakerProxyHandle, PluginApi } from '../../../plugin-sdk/src/types';

export interface FileRef {
  root: string;   // 'gcodes' | 'config' | 'logs' | 'docs' | 'config_examples'
  path: string;   // относительно root, напр. 'mapping/foo.gcode'
  isDir: boolean;
}

export function fullPath(ref: FileRef): string {
  return ref.path ? `${ref.root}/${ref.path}` : ref.root;
}

/** The Config editor protects Klipper and Moonraker config files in every subdirectory. */
export function configBackupRef(ref: FileRef): FileRef | null {
  return ref.root === 'config' && !ref.isDir && /\.(cfg|conf)$/i.test(ref.path)
    ? { ...ref, path: `${ref.path}.bak`, isDir: false }
    : null;
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function baseOf(path: string): string {
  return path.split('/').pop() ?? 'file';
}

function encodeSegments(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

export function createFileOps(api: PluginApi) {
  const handle = () => api.moonraker();

  /** Bearer-токен для fetch (если Moonraker требует авторизацию). */
  function authHeaders(): Record<string, string> {
    const token = handle().authToken;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * URL для ресурсов, где заголовок задать нельзя (скачивание по ссылке, <img>):
   * токен уходит query-параметром access_token. Без токена URL не меняется.
   */
  function withToken(url: string): string {
    const token = handle().authToken;
    if (!token) return url;
    return `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  }

  function fileUrl(ref: FileRef): string {
    return `${handle().httpBaseUrl}/server/files/${encodeSegments(fullPath(ref))}`;
  }

  /** URL для просмотра (картинки в просмотрщике). */
  function viewUrl(ref: FileRef): string {
    return withToken(fileUrl(ref));
  }

  async function startPrint(ref: FileRef): Promise<void> {
    await handle().request('printer.print.start', { filename: ref.path });
  }

  async function refreshMetadata(ref: FileRef): Promise<void> {
    // metascan работает только с gcode и ждёт путь относительно gcodes-рута
    if (ref.root !== 'gcodes') return;

    await handle().request('server.files.metascan', {
      filename: ref.path,   // было: fullPath(ref) с префиксом 'gcodes/'
      force: true,
    });
  }

  async function createZip(ref: FileRef): Promise<void> {
    await handle().request('server.files.zip', {
      items: [fullPath(ref)],
      dest: `${fullPath(ref)}.zip`,
    });
  }

  function download(ref: FileRef): void {
    const a = document.createElement('a');
    a.href = withToken(fileUrl(ref));
    a.download = baseOf(ref.path);
    a.rel = 'noopener';
    a.click();
  }

  async function rename(ref: FileRef, newName: string): Promise<void> {
    const dir = dirOf(ref.path);
    await handle().request('server.files.move', {
      source: fullPath(ref),
      dest: `${ref.root}/${dir ? dir + '/' : ''}${newName}`,
    });
  }

  async function copy(ref: FileRef, newName?: string): Promise<void> {
    const dir = dirOf(ref.path);
    const name = newName ?? baseOf(ref.path).replace(/(\.[^.]+)?$/, (m) => `_copy${m}`);
    await handle().request('server.files.copy', {
      source: fullPath(ref),
      dest: `${ref.root}/${dir ? dir + '/' : ''}${name}`,
    });
  }

  async function remove(ref: FileRef): Promise<void> {
    if (ref.isDir) {
      await handle().request('server.files.delete_directory', { path: fullPath(ref), force: true });
    } else {
      await handle().request('server.files.delete_file', { path: fullPath(ref) });
    }
  }

  /** Read from a fixed printer handle so a printer-tab switch cannot mix comparison inputs. */
  async function readText(ref: FileRef, target = handle()): Promise<string> {
    const url = `${target.httpBaseUrl}/server/files/${encodeSegments(fullPath(ref))}?t=${Date.now()}`;
    const res = await fetch(url, {
      cache: 'no-store',
      headers: target.authToken ? { Authorization: `Bearer ${target.authToken}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  /** Скачивает файл целиком (например, .3mf для инспектора) с токеном авторизации. */
  async function readBlob(ref: FileRef): Promise<Blob> {
    const res = await fetch(fileUrl(ref), { cache: 'no-store', headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  }

  async function saveText(ref: FileRef, content: string, target = handle()): Promise<void> {
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const form = new FormData();
    form.append('file', blob, baseOf(ref.path));
    const dir = dirOf(ref.path);
    if (dir) form.append('path', dir);
    form.append('root', ref.root);
    const res = await fetch(`${target.httpBaseUrl}/server/files/upload`, {
      method: 'POST',
      headers: target.authToken ? { Authorization: `Bearer ${target.authToken}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  /** Copy the exact on-disk bytes before uploading edited text; a failed copy prevents the save. */
  async function saveConfigText(ref: FileRef, content: string, target: MoonrakerProxyHandle = handle()): Promise<void> {
    const backup = configBackupRef(ref);
    if (!backup) throw new Error('config.backupInvalid');
    await target.request('server.files.copy', { source: fullPath(ref), dest: fullPath(backup) });
    await saveText(ref, content, target);
  }

  /** Restore the saved bytes without overwriting the backup itself. */
  async function restoreConfigBackup(ref: FileRef, target: MoonrakerProxyHandle = handle()): Promise<void> {
    const backup = configBackupRef(ref);
    if (!backup) throw new Error('config.backupInvalid');
    await target.request('server.files.copy', { source: fullPath(backup), dest: fullPath(ref) });
  }

  async function upload(
    root: string,
    dir: string,
    file: File,
    print = false,
  ): Promise<void> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('root', root);
    if (dir) form.append('path', dir);
    if (print) form.append('print', 'true');

    const res = await fetch(`${handle().httpBaseUrl}/server/files/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function createDirectory(root: string, path: string): Promise<void> {
    await handle().request('server.files.post_directory', { path: `${root}/${path}` });
  }

  async function createFile(root: string, dir: string, name: string): Promise<void> {
    const blob = new Blob([''], { type: 'application/octet-stream' });
    const form = new FormData();
    form.append('file', blob, name);
    form.append('root', root);
    if (dir) form.append('path', dir);

    const res = await fetch(`${handle().httpBaseUrl}/server/files/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  return {
    fileUrl, viewUrl, startPrint, refreshMetadata, createZip, download,
    rename, copy, remove, readText, readBlob, saveText, saveConfigText, restoreConfigBackup,
    upload, createDirectory, createFile
  };
}

export type FileOps = ReturnType<typeof createFileOps>;
