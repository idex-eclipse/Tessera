import { parseGcode, type ParsedGcode } from './parse-gcode';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (p: ParsedGcode) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: ParsedGcode; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.result) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error ?? 'parse error'));
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function parseGcodeAsync(text: string): Promise<ParsedGcode> {
  const w = ensureWorker();
  if (!w) {
    return new Promise((resolve) => setTimeout(() => resolve(parseGcode(text)), 0));
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, text });
  });
}