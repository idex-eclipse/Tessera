<script lang="ts">
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

  import { deviationRgb, niceTicks, norm, type MeshStats, type SurfaceGrid } from '../mesh-math';

  let {
    grid,
    stats,
    exaggeration = 10,
    showBasePlane = true,
    showWireframe = false,
    clipMin = -Infinity,
    clipMax = Infinity,
  }: {
    grid: SurfaceGrid | null;
    stats: MeshStats | null;
    exaggeration?: number;
    showBasePlane?: boolean;
    showWireframe?: boolean;
    clipMin?: number;
    clipMax?: number;
  } = $props();

  let wrapEl: HTMLDivElement | null = $state(null);
  let canvasEl: HTMLCanvasElement | null = $state(null);

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let controls: OrbitControls | null = null;

  let surfaceGeom: THREE.BufferGeometry | null = null;
  let surfaceObj: THREE.Mesh | null = null;
  let wireObj: THREE.Mesh | null = null;
  let staticGroup: THREE.Group | null = null;
  let baseObj: THREE.Mesh | null = null;

  let cameraFitted = false;

  const GRID_COLOR = 0x33383f;
  const LABEL_CSS = '#a7adb5';

  function render(): void {
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  // ------------------------------------------------------------------
  // init / dispose
  // ------------------------------------------------------------------

  function initThree(): void {
    if (!canvasEl || !wrapEl || renderer) return;

    const w = wrapEl.clientWidth || 1;
    const h = wrapEl.clientHeight || 1;

    renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100000);
    controls = new OrbitControls(camera, canvasEl);
    controls.addEventListener('change', render);
  }

  function onResize(): void {
    if (!renderer || !camera || !wrapEl) return;
    const w = wrapEl.clientWidth;
    const h = wrapEl.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  }

  function disposeObject(root: THREE.Object3D): void {
    root.traverse((child: THREE.Object3D) => {
      const node = child as unknown as {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };

      node.geometry?.dispose();

      const mats = Array.isArray(node.material)
        ? node.material
        : node.material
          ? [node.material]
          : [];

      for (const m of mats) {
        const spriteMat = m as THREE.SpriteMaterial;
        if (spriteMat.map) spriteMat.map.dispose();
        m.dispose();
      }
    });
  }

  function clearSurface(): void {
    if (surfaceObj) scene?.remove(surfaceObj);
    if (wireObj) scene?.remove(wireObj);
    if (surfaceGeom) surfaceGeom.dispose();
    surfaceObj = null;
    wireObj = null;
    surfaceGeom = null;
  }

  function clearStatic(): void {
    if (staticGroup) {
      scene?.remove(staticGroup);
      disposeObject(staticGroup);
      staticGroup = null;
    }
    baseObj = null;
  }

  // ------------------------------------------------------------------
  // вспомогательные построители
  // ------------------------------------------------------------------

  function bounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const xs = grid?.xs ?? [0, 1];
    const ys = grid?.ys ?? [0, 1];
    return {
      minX: xs[0] ?? 0,
      maxX: xs[xs.length - 1] ?? 1,
      minY: ys[0] ?? 0,
      maxY: ys[ys.length - 1] ?? 1,
    };
  }

  function linesFrom(pts: number[]): THREE.LineSegments {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: GRID_COLOR }));
  }

  function makeLabel(text: string, worldSize: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = '600 40px sans-serif';
      ctx.fillStyle = LABEL_CSS;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 64, 32);
    }
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, depthTest: false }),
    );
    sprite.scale.set(worldSize * 2, worldSize, 1);
    return sprite;
  }

  function fmtTick(v: number): string {
    return Number(v.toPrecision(3)).toString();
  }

  // ------------------------------------------------------------------
  // статика: бокс координат от физического (0,0,0)
  // ------------------------------------------------------------------

  function buildStatic(): void {
    if (!scene) return;
    clearStatic();
    if (!grid || !stats) return;

    const { minX, maxX, minY, maxY } = bounds();
    const size = Math.max(maxX - minX, maxY - minY, 1);

    const xTicks = niceTicks(minX, maxX, 6);
    const yTicks = niceTicks(minY, maxY, 6);
    const zTicks = niceTicks(stats.min, stats.max, 5);
    const zMin = Math.min(stats.min, zTicks[0] ?? stats.min);
    const zMax = Math.max(stats.max, zTicks[zTicks.length - 1] ?? stats.max);
    const floorY = zMin * exaggeration;
    const topY = zMax * exaggeration;

    const ts = size / 20;        // размер цифр тиков
    const ax = size / 14;        // размер букв осей
    const arrowLen = size / 16;
    const arrowRad = size / 60;
    const AXIS_COLOR = 0x8a93a0; // оси ярче фоновой сетки

    staticGroup = new THREE.Group();

    // --------------------------------------------------------------
    // бокс-сетка: пол + ДАЛЬНИЕ от камеры стены (камера теперь у нуля)
    // --------------------------------------------------------------
    const pts: number[] = [];

    // пол XY
    for (const xt of xTicks) pts.push(xt, floorY, minY, xt, floorY, maxY);
    for (const yt of yTicks) pts.push(minX, floorY, yt, maxX, floorY, yt);
    // стена XZ (bed Y = maxY)
    for (const xt of xTicks) pts.push(xt, floorY, maxY, xt, topY, maxY);
    for (const zt of zTicks) pts.push(minX, zt * exaggeration, maxY, maxX, zt * exaggeration, maxY);
    // стена YZ (bed X = maxX)
    for (const yt of yTicks) pts.push(maxX, floorY, yt, maxX, topY, yt);
    for (const zt of zTicks) pts.push(maxX, zt * exaggeration, minY, maxX, zt * exaggeration, maxY);

    staticGroup.add(linesFrom(pts));

    // --------------------------------------------------------------
    // оси из физического (0, 0, 0) + стрелки направления X/Y/Z
    // --------------------------------------------------------------
    const axisPts: number[] = [];
    // X
    axisPts.push(0, floorY, 0, maxX + arrowLen, floorY, 0);
    // Y (bed Y → three Z)
    axisPts.push(0, floorY, 0, 0, floorY, maxY + arrowLen);
    // Z (вверх)
    axisPts.push(0, floorY, 0, 0, topY + arrowLen, 0);

    const axesLines = linesFrom(axisPts);
    (axesLines.material as THREE.LineBasicMaterial).color.setHex(AXIS_COLOR);
    staticGroup.add(axesLines);

    const mkArrow = (
      rotX: number,
      rotZ: number,
      px: number,
      py: number,
      pz: number,
    ): void => {
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(arrowRad, arrowLen, 12),
        new THREE.MeshBasicMaterial({ color: AXIS_COLOR }),
      );
      m.rotation.x = rotX;
      m.rotation.z = rotZ;
      m.position.set(px, py, pz);
      staticGroup?.add(m);
    };

    // конус по умолчанию смотрит в +Y:
    mkArrow(0, -Math.PI / 2, maxX + arrowLen * 0.6, floorY, 0); // → +X
    mkArrow(Math.PI / 2, 0, 0, floorY, maxY + arrowLen * 0.6); // → +Y
    mkArrow(0, 0, 0, topY + arrowLen * 0.6, 0);                // → +Z

    // буквы осей на положительных концах
    const lx = makeLabel('X', ax);
    lx.position.set(maxX + ax * 2, floorY, 0);
    const ly = makeLabel('Y', ax);
    ly.position.set(0, floorY, maxY + ax * 2);
    const lz = makeLabel('Z', ax);
    lz.position.set(0, topY + ax * 1.6, 0);
    staticGroup.add(lx, ly, lz);

    // --------------------------------------------------------------
    // тики вдоль осей у нулевого угла
    // --------------------------------------------------------------
    for (const xt of xTicks) {
      const s = makeLabel(fmtTick(xt), ts);
      s.position.set(xt, floorY, -ts * 1.4);
      staticGroup.add(s);
    }
    for (const yt of yTicks) {
      const s = makeLabel(fmtTick(yt), ts);
      s.position.set(-ts * 1.4, floorY, yt);
      staticGroup.add(s);
    }
    for (const zt of zTicks) {
      const s = makeLabel(fmtTick(zt), ts);
      s.position.set(-ts * 1.4, zt * exaggeration, -ts * 1.4);
      staticGroup.add(s);
    }

    // --------------------------------------------------------------
    // базовая плоскость Z=0
    // --------------------------------------------------------------
    baseObj = new THREE.Mesh(
      new THREE.PlaneGeometry(maxX - minX, maxY - minY),
      new THREE.MeshBasicMaterial({
        color: 0x8aa8ff,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    baseObj.rotation.x = -Math.PI / 2;
    baseObj.position.set((minX + maxX) / 2, 0, (minY + maxY) / 2);
    baseObj.visible = showBasePlane;
    staticGroup.add(baseObj);

    scene.add(staticGroup);
  }

  // ------------------------------------------------------------------
  // поверхность с клиппингом по шкале
  // ------------------------------------------------------------------

  function buildSurface(): void {
    if (!scene) return;
    clearSurface();
    if (!grid || !stats) return;

    const rows = grid.values.length;
    const cols = grid.values[0]?.length ?? 0;
    if (rows < 2 || cols < 2) return;

    const lo = Number.isFinite(clipMin) ? clipMin : stats.min;
    const hi = Number.isFinite(clipMax) ? clipMax : stats.max;

    const positions = new Float32Array(rows * cols * 3);
    const colors = new Float32Array(rows * cols * 3);
    const inRange = new Uint8Array(rows * cols);

    for (let r = 0; r < rows; r++) {
      const y = grid.ys[r] ?? 0;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const i = idx * 3;
        const v = grid.values[r]?.[c] ?? 0;

        positions[i] = grid.xs[c] ?? 0;
        positions[i + 1] = v * exaggeration;
        positions[i + 2] = y;

        const [rr, gg, bb] = deviationRgb(norm(v, lo, hi));
        colors[i] = rr / 255;
        colors[i + 1] = gg / 255;
        colors[i + 2] = bb / 255;

        inRange[idx] = v >= lo && v <= hi ? 1 : 0;
      }
    }

    // клетка = два треугольника (a,d,b) и (b,d,e);
    // треугольник отсекается, если ХОТЯ БЫ ОДНА его вершина вне диапазона
    const indices: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = (r + 1) * cols + c;
        const e = d + 1;

        if (inRange[a] && inRange[d] && inRange[b]) indices.push(a, d, b);
        if (inRange[b] && inRange[d] && inRange[e]) indices.push(b, d, e);
      }
    }

    surfaceGeom = new THREE.BufferGeometry();
    surfaceGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    surfaceGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    surfaceGeom.setIndex(indices);
    surfaceGeom.computeVertexNormals();

    surfaceObj = new THREE.Mesh(
      surfaceGeom,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    scene.add(surfaceObj);

    wireObj = new THREE.Mesh(
      surfaceGeom,
      new THREE.MeshBasicMaterial({
        wireframe: true,
        color: 0xffffff,
        transparent: true,
        opacity: 0.12,
      }),
    );
    wireObj.visible = showWireframe;
    scene.add(wireObj);
  }

  function fitCamera(): void {
    if (!camera || !controls || !grid) return;
    const { minX, maxX, minY, maxY } = bounds();
    // центр с учётом осей у нуля, чтобы нулевой угол не резался
    const cx = (Math.min(minX, 0) + maxX) / 2;
    const cz = (Math.min(minY, 0) + maxY) / 2;
    const size = Math.max(maxX - minX, maxY - minY, 1) * 1.1;

    camera.near = size / 1000;
    camera.far = size * 1000;
    // камера со стороны (0, 0) — смотрим на карту от нулевого угла
    camera.position.set(cx - size * 0.8, size * 0.9, cz - size * 0.8);
    controls.target.set(cx, 0, cz);
    controls.update();
  }

  function maybeFitCamera(): void {
    if (cameraFitted || !grid) return;
      fitCamera();
    cameraFitted = true;
  }

  // ------------------------------------------------------------------
  // эффекты
  // ------------------------------------------------------------------

  // mount: init + resize + одноразовый dispose
$effect(() => {
  initThree();
  const wrap = wrapEl;
  const ro = new ResizeObserver(onResize);
  if (wrap) ro.observe(wrap);

  return () => {
    ro.disconnect();
    clearSurface();
    clearStatic();
    controls?.dispose();
    renderer?.dispose();
    controls = null;
    renderer = null;
    scene = null;
    camera = null;
  };
});

// новая сетка: стены + поверхность; камера — только если ещё не центрована
$effect(() => {
  void grid;
  buildStatic();
  buildSurface();
  maybeFitCamera();
  render();
});

// преувеличение: стены/тики и поверхность; камера НЕ трогается
$effect(() => {
  void exaggeration;
  buildStatic();
  buildSurface();
  render();
});

// шкала-клиппинг: только индекс-буфер поверхности; камера НЕ трогается
$effect(() => {
  void clipMin;
  void clipMax;
  buildSurface();
  render();
});

// тумблеры: только видимость
$effect(() => {
  if (wireObj) wireObj.visible = showWireframe;
  if (baseObj) baseObj.visible = showBasePlane;
  render();
});
</script>

<div class="canvas-wrap" bind:this={wrapEl}>
  <canvas bind:this={canvasEl}></canvas>
</div>

<style>
  .canvas-wrap {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    width: 100%;
  }

  .canvas-wrap canvas {
    position: absolute;
    inset: 0;
    touch-action: none;
  }
</style>