import type { PluginApi } from '../../../plugin-sdk/src/types';

export interface FileRef {
  root: string;   // 'gcodes' | 'config' | 'logs' | 'docs' | 'config_examples'
  path: string;   // относительно root, напр. 'mapping/foo.gcode'
  isDir: boolean;
}

export function fullPath(ref: FileRef): string {
  return ref.path ? `${ref.root}/${ref.path}` : ref.root;
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

  function fileUrl(ref: FileRef): string {
    return `${handle().httpBaseUrl}/server/files/${encodeSegments(fullPath(ref))}`;
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
    a.href = fileUrl(ref);
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

  async function readText(ref: FileRef): Promise<string> {
    const url = `${fileUrl(ref)}?t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  async function saveText(ref: FileRef, content: string): Promise<void> {
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const form = new FormData();
    form.append('file', blob, baseOf(ref.path));
    const dir = dirOf(ref.path);
    if (dir) form.append('path', dir);
    form.append('root', ref.root);
    const res = await fetch(`${handle().httpBaseUrl}/server/files/upload`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      body: form,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  return {
    fileUrl, startPrint, refreshMetadata, createZip, download,
    rename, copy, remove, readText, saveText,
    upload, createDirectory, createFile
  };
}

export type FileOps = ReturnType<typeof createFileOps>;