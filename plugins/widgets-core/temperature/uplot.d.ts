/**
 * Minimal ambient declarations for uPlot (package ships no types).
 */
declare module 'uplot' {
  class uPlot {
    constructor(opts: unknown, data: unknown, target?: HTMLElement);

    readonly over: HTMLElement;
    readonly under: HTMLElement;
    readonly root: HTMLElement;
    readonly width: number;
    readonly height: number;

    data: any[];
    scales: Record<string, { min?: number; max?: number }>;
    cursor: { left?: number; top?: number };

    setData(data: unknown): void;
    setSize(size: { width: number; height: number }): void;
    setScale(key: string, range: { min: number; max: number }): void;
    posToVal(px: number, scale: string): number;
    destroy(): void;
  }

  export default uPlot;
}

declare module 'uplot/dist/uPlot.min.css';