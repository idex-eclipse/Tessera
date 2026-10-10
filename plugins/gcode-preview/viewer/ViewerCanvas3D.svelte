<script lang="ts">
  import { untrack } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

  import { extruderRgb, typeRgb } from './colors';
  import type { ParsedGcode } from './parse-gcode';

  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';
  import { useKlippyState } from '../../shared/klippy-state/use-klippy-state.svelte.ts';
  import Icon from '../../shared/icons/Icon.svelte';
  import { useExcludeObjects } from './use-exclude-objects.svelte';
  import ConfirmDialog from '../../shared/confirm-dialog.svelte';

  // ---- 1. props первым: Svelte 5 требует объявление до первого $effect ----
  let {
    parsed,
    layer,
    showTravel = false,
    showBounds = true,
    colorMode = 'extruder',
    progressSeg = null,
  }: {
    parsed: ParsedGcode;
    layer: number;
    showTravel?: boolean;
    showBounds?: boolean;
    colorMode?: 'extruder' | 'type';
    progressSeg?: number | null;
  } = $props();

  // ---- 2. top-level hooks ----
  const api = usePluginApi();
  const i18n = api.i18n;
  const klippy = useKlippyState(api);
  const excludeStore = useExcludeObjects(api);

  // ---- 3. state ----
  let wrapEl = $state<HTMLDivElement | null>(null);
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let wrapSize = $state({ w: 0, h: 0 });
  let threeReady = $state(false);
  let buttonPositions = $state<Array<{
    name: string; excluded: boolean; x: number; y: number; visible: boolean;
  }>>([]);

  // ---- 4. three.js refs ----
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let controls: OrbitControls | null = null;

  let extrudeObj: THREE.LineSegments | null = null;
  let travelObj: THREE.LineSegments | null = null;
  let extrudeEndByLayer: Uint32Array | null = null;
  let progressObj: THREE.LineSegments | null = null;
  let extrudePrefix: Uint32Array | null = null;

  // exclude: Map по имени объекта → mesh fill + line verts + материалы.
  // Геометрия строится один раз; материалы апдейтятся на каждый тик status.
  let excludeVisuals = new Map<string, {
    fill: THREE.Mesh;
    verts: THREE.LineSegments;
    fillMat: THREE.MeshBasicMaterial;
    lineMat: THREE.LineBasicMaterial;
  }>();

  // подтверждение исключения: клик паркует имя, команда уходит только из диалога
  let confirmExclude = $state<string | null>(null);

  function doExclude(): void {
    if (confirmExclude) void excludeStore.exclude(confirmExclude);
    confirmExclude = null;
  }

  // ---- 5. derived ----
  let excludeNamesHash = $derived(
    excludeStore.objects.map((o) => `${o.name}|${o.polygon.length}`).join(';'),
  );

  // ---- 6. functions ----

  function render(): void {
    if (renderer && scene && camera) renderer.render(scene, camera);
    updateExcludeButtons();
  }

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

    threeReady = true;
  }

  function fitCamera(): void {
    if (!camera || !controls) return;
    const { bounds } = parsed;
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    const height = parsed.layerZ[parsed.layerZ.length - 1] ?? 0;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minY + bounds.maxY) / 2;
    const size = Math.max(bw, bh, height, 1);

    camera.near = size / 1000;
    camera.far = size * 100;
    camera.position.set(cx + size, height + size * 1.2, cz + size);
    controls.target.set(cx, height / 2, cz);
    controls.update();
  }

  function onResize(): void {
    if (!renderer || !camera || !wrapEl) return;
    const w = wrapEl.clientWidth;
    const h = wrapEl.clientHeight;
    if (!w || !h) return;
    wrapSize = { w, h };
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
    updateExcludeButtons();
  }

  function clearMeshes(): void {
    for (const obj of [extrudeObj, travelObj]) {
      if (obj) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
        scene?.remove(obj);
      }
    }
    for (const v of excludeVisuals.values()) {
      v.fill.geometry.dispose();
      v.verts.geometry.dispose();
      v.fillMat.dispose();
      v.lineMat.dispose();
      scene?.remove(v.fill);
      scene?.remove(v.verts);
    }
    excludeVisuals.clear();

    extrudeObj = travelObj = null;
    extrudeEndByLayer = null;
    progressObj = null;
    extrudePrefix = null;
  }

  function buildMeshes(): void {
    if (!scene) return;

    const n = parsed.moveCount;
    const pos = parsed.positions;

    let extCount = 0;
    let travCount = 0;
    for (let i = 0; i < n; i++) {
      if (parsed.kinds[i] === 1) extCount++;
      else travCount++;
    }

    const ePos = new Float32Array(extCount * 6);
    const eCol = new Uint8Array(extCount * 6);
    const tPos = new Float32Array(travCount * 6);
    const eEnd = new Uint32Array(Math.max(1, parsed.layerZ.length));

    let we = 0;
    let wt = 0;
    let curLayer = 0;

    for (let i = 0; i < n; i++) {
      const o = i * 6;
      if (parsed.kinds[i] === 1) {
        const wo = we * 6;
        ePos[wo] = pos[o]!;     ePos[wo + 1] = pos[o + 2]!; ePos[wo + 2] = pos[o + 1]!;
        ePos[wo + 3] = pos[o + 3]!; ePos[wo + 4] = pos[o + 5]!; ePos[wo + 5] = pos[o + 4]!;

        const [r, g, b] = colorMode === 'extruder'
          ? extruderRgb(parsed.extruders[i] ?? 0)
          : typeRgb(parsed.segTypes[i] ?? 0);

        eCol[wo] = r;     eCol[wo + 1] = g;     eCol[wo + 2] = b;
        eCol[wo + 3] = r; eCol[wo + 4] = g;     eCol[wo + 5] = b;
        we++;

        const l = parsed.layers[i] ?? 0;
        while (curLayer <= l) {
          eEnd[curLayer] = we * 2;
          curLayer++;
        }
      } else {
        const wo = wt * 6;
        tPos[wo] = pos[o]!;     tPos[wo + 1] = pos[o + 2]!; tPos[wo + 2] = pos[o + 1]!;
        tPos[wo + 3] = pos[o + 3]!; tPos[wo + 4] = pos[o + 5]!; tPos[wo + 5] = pos[o + 4]!;
        wt++;
      }
    }
    while (curLayer < eEnd.length) {
      eEnd[curLayer] = we * 2;
      curLayer++;
    }
    extrudeEndByLayer = eEnd;

    const eGeom = new THREE.BufferGeometry();
    eGeom.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    eGeom.setAttribute('color', new THREE.BufferAttribute(eCol, 3, true));
    extrudeObj = new THREE.LineSegments(
      eGeom,
      new THREE.LineBasicMaterial({ vertexColors: true }),
    );
    scene.add(extrudeObj);

    const prefix = new Uint32Array(n + 1);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      prefix[i] = acc;
      if (parsed.kinds[i] === 1) acc++;
    }
    prefix[n] = acc;
    extrudePrefix = prefix;

    const pGeom = new THREE.BufferGeometry();
    pGeom.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    progressObj = new THREE.LineSegments(
      pGeom,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    progressObj.renderOrder = 10;
    progressObj.visible = false;
    scene.add(progressObj);

    const tGeom = new THREE.BufferGeometry();
    tGeom.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    travelObj = new THREE.LineSegments(
      tGeom,
      new THREE.LineBasicMaterial({ color: 0x808080, transparent: true, opacity: 0.35 }),
    );
    travelObj.visible = showTravel;
    scene.add(travelObj);
  }

  function buildExcludeGeometry(): void {
    if (!scene) return;

    // cleanup старого
    for (const v of excludeVisuals.values()) {
      v.fill.geometry.dispose();
      v.verts.geometry.dispose();
      v.fillMat.dispose();
      v.lineMat.dispose();
      scene.remove(v.fill);
      scene.remove(v.verts);
    }
    excludeVisuals.clear();

    const objs = excludeStore.objects;
    if (objs.length === 0) return;

    const height = parsed.layerZ[parsed.layerZ.length - 1] ?? 1;

    for (const o of objs) {
      if (o.polygon.length < 3) continue;

      const shape = new THREE.Shape();
      shape.moveTo(o.polygon[0]!.x, o.polygon[0]!.y);
      for (let i = 1; i < o.polygon.length; i++) {
        shape.lineTo(o.polygon[i]!.x, o.polygon[i]!.y);
      }
      shape.closePath();

      const fillGeom = new THREE.ShapeGeometry(shape);
      const fillMat = new THREE.MeshBasicMaterial({
        color: o.excluded ? 0x808080 : 0x8aa8ff,
        transparent: true,
        opacity: o.excluded ? 0.06 : 0.12,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const fill = new THREE.Mesh(fillGeom, fillMat);
      fill.rotation.x = Math.PI / 2;    // +π/2: (shapeX, shapeY, 0) → (shapeX, 0, shapeY)
      fill.position.y = height;
      fill.renderOrder = 11;
      scene.add(fill);

      const verts: number[] = [];
      for (let i = 0; i < o.polygon.length; i++) {
        const a = o.polygon[i]!;
        const b = o.polygon[(i + 1) % o.polygon.length]!;
        verts.push(a.x, 0, a.y, a.x, height, a.y);
        verts.push(a.x, height, a.y, b.x, height, b.y);
        verts.push(a.x, 0, a.y, b.x, 0, b.y);
      }
      const vertsGeom = new THREE.BufferGeometry();
      vertsGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
      const lineMat = new THREE.LineBasicMaterial({
        color: o.excluded ? 0x808080 : 0x8aa8ff,
        transparent: true,
        opacity: o.excluded ? 0.3 : 0.5,
        depthTest: false,
      });
      const vertsLines = new THREE.LineSegments(vertsGeom, lineMat);
      vertsLines.renderOrder = 12;
      scene.add(vertsLines);

      excludeVisuals.set(o.name, { fill, verts: vertsLines, fillMat, lineMat });
    }
  }

  function updateExcludeVisuals(): void {
    for (const o of excludeStore.objects) {
      const v = excludeVisuals.get(o.name);
      if (!v) continue;
      const baseColor = o.excluded ? 0x808080 : (o.current ? 0xffb400 : 0x8aa8ff);
      v.fillMat.color.setHex(baseColor);
      v.fillMat.opacity = o.excluded ? 0.06 : (o.current ? 0.2 : 0.12);
      v.lineMat.color.setHex(baseColor);
      v.lineMat.opacity = o.excluded ? 0.3 : (o.current ? 0.8 : 0.5);
    }
  }

  function applyLayer(l: number): void {
    if (!extrudeObj || !extrudeEndByLayer) return;
    const idx = Math.min(l, extrudeEndByLayer.length - 1);
    extrudeObj.geometry.setDrawRange(0, extrudeEndByLayer[idx] ?? 0);
  }

  function updateExcludeButtons(): void {
    if (!camera || !wrapEl) { buttonPositions = []; return; }
    const w = wrapSize.w || wrapEl.clientWidth;
    const h = wrapSize.h || wrapEl.clientHeight;
    if (!w || !h) { buttonPositions = []; return; }

    camera.updateMatrixWorld();   // проекция по актуальной матрице

    const height = parsed.layerZ[parsed.layerZ.length - 1] ?? 1;
    const midY = height / 2;
    const out: typeof buttonPositions = [];
    for (const o of excludeStore.objects) {
      const v = new THREE.Vector3(o.center.x, midY, o.center.y).project(camera);
      out.push({
        name: o.name,
        excluded: o.excluded,
        x: (v.x + 1) / 2 * w,
        y: (-v.y + 1) / 2 * h,
        visible: v.z > 0 && v.z < 1,
      });
    }
    buttonPositions = out;
  }

  // ---- 7. effects — порядок критичен ----

  // mount: init three + resize; cleanup
  $effect(() => {
    initThree();
    const wrap = wrapEl;
    const ro = new ResizeObserver(onResize);
    if (wrap) ro.observe(wrap);

    return () => {
      threeReady = false;
      ro.disconnect();
      clearMeshes();
      controls?.dispose();
      renderer?.dispose();
      controls = null;
      renderer = null;
      scene = null;
      camera = null;
    };
  });

  // новый файл parsed → перецентрировать камеру
  $effect(() => {
    void parsed;
    fitCamera();
    render();
  });

  // parsed + colorMode → rebuild мешей модели
  $effect(() => {
    void parsed;
    void colorMode;
    buildMeshes();
    applyLayer(untrack(() => layer));
    render();
    return () => clearMeshes();
  });

  // layer → только drawRange
  $effect(() => {
    applyLayer(layer);
    render();
  });

  // showTravel / showBounds → видимость
  $effect(() => {
    if (travelObj) travelObj.visible = showTravel;
    render();
  });

  // progressSeg → drawRange оверлея
  $effect(() => {
    if (!progressObj || !extrudePrefix) return;
    if (progressSeg == null) {
      progressObj.visible = false;
    } else {
      progressObj.visible = true;
      progressObj.geometry.setDrawRange(0, (extrudePrefix[progressSeg + 1] ?? 0) * 2);
    }
    render();
  });

  // exclude-геометрия: ждёт threeReady + rebuild по parsed/составу объектов
  $effect(() => {
    if (!threeReady) return;
    void parsed;
    void excludeStore.available;
    void excludeNamesHash;
    buildExcludeGeometry();
    updateExcludeVisuals();
    updateExcludeButtons();
    render();
  });

  // exclude-визуалы: быстрый апдейт цветов/opacity на каждый тик status
  $effect(() => {
    void excludeStore.objects;
    updateExcludeVisuals();
    render();
  });
</script>

<div class="canvas-wrap" bind:this={wrapEl}>
  <canvas bind:this={canvasEl}></canvas>
  {#each buttonPositions.filter((b) => b.visible) as bp (bp.name)}
    <button
      class="obj-btn"
      class:excluded={bp.excluded}
      disabled={!klippy.ready || bp.excluded}
      title={bp.excluded
        ? i18n.t('gcodePreview.excluded')
        : !klippy.ready
          ? i18n.t('common.klipperNotReady')
          : i18n.t('gcodePreview.excludeObject', { name: bp.name })}
      style:left="{bp.x}px"
      style:top="{bp.y}px"
      onclick={(e) => {
        e.stopPropagation();
        if (klippy.ready && !bp.excluded) confirmExclude = bp.name;
      }}
    >
      <Icon name="x" size={12} />
    </button>
  {/each}
</div>

<ConfirmDialog
  open={confirmExclude !== null}
  title={i18n.t('gcodePreview.excludeConfirmTitle')}
  message={i18n.t('gcodePreview.excludeConfirmMessage', { name: confirmExclude ?? '' })}
  confirmLabel={i18n.t('gcodePreview.excludeConfirmLabel')}
  danger={true}
  onConfirm={doExclude}
  onClose={() => (confirmExclude = null)}
/>

<style>
  .canvas-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
  }

  .canvas-wrap canvas { position: absolute; inset: 0; touch-action: none; }

  .obj-btn {
    position: absolute;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--warning) 60%, transparent);
    border-radius: 50%;
    background: var(--bg-surface);
    color: var(--warning);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translate(-50%, -50%);
    box-shadow: var(--shadow-sm);
    z-index: 2;
    pointer-events: auto;
  }

  .obj-btn:hover:not(:disabled) {
    background: var(--warning);
    color: #fff;
  }

  .obj-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .obj-btn.excluded {
    background: var(--bg-surface-hover);
    color: var(--text-muted);
    border-color: var(--border-color);
  }
</style>