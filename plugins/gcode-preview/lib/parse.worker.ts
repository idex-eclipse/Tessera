import { parseGcode } from './parse-gcode';

const selfW = self as unknown as Worker;

selfW.onmessage = (e: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = e.data;
  try {
    const r = parseGcode(text);
    selfW.postMessage(
      { id, result: r },
      [
        r.positions.buffer,
        r.kinds.buffer,
        r.extruders.buffer,
        r.layers.buffer,
        r.offsets.buffer,
        r.layerStart.buffer,
        r.segTypes.buffer
      ],
    );
  } catch (err) {
    selfW.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};