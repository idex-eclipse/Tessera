<script lang="ts">
  import { untrack } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

  import { extruderRgb, typeRgb } from './colors';
  import type { ParsedGcode } from './parse-gcode';

  import { usePluginApi } from '../../../plugin-sdk/src/svelte/index';
  import { useKlippyState } from '../../shared/klippy-state/use-klippy-state.svelte.ts';
  import Icon from '../../shared/icons/Icon.svelte';
  import { useExcludeObjects } from '../../shared/exclude-objects/use-exclude-objects.svelte.ts';
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
  // Физическая толщина колбаски: стандартный nozzle 0.4 мм.
  // Высота слоя определяется автоматически по Z-дельте (через scale Y).
  const FILAMENT_RADIUS = 0.2; // мм (диаметр 0.4)
  const RADIAL_SEGMENTS = 6;    // 6 граней = шестиугольник в сечении

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let controls: OrbitControls | null = null;
  let ambientLight: THREE.AmbientLight | null = null;
  let dirLight: THREE.DirectionalLight | null = null;
  let templateGeom: THREE.CylinderGeometry | null = null;

  // Экструзия: InstancedMesh (один цилиндр = один сегмент)
  let extrudeObj: THREE.InstancedMesh | null = null;
  let progressObj: THREE.InstancedMesh | null = null;
  // Travel остаётся LineSegments (тонкая линия без объёма)
  let travelObj: THREE.LineSegments | null = null;
  // Счётчик инстансов по слоям — для applyLayer через mesh.count
  let instancesUpToLayer: Uint32Array | null = null;
  // Префикс-сумма для progressSeg: индекс экструзионного сегмента по индексу move
  let extrudePrefix: Uint32Array | null = null;

  let excludeVisuals = new Map<string, {
    fill: THREE.Mesh;
    verts: THREE.LineSegments;
    fillMat: THREE.MeshBasicMaterial;
    lineMat: THREE.LineBasicMaterial;
  }>();

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

    // Освещение для MeshLambertMaterial — читаемый объём колбасок
    ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);
    dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 200, 100);
    scene.add(dirLight);

    // Общий template-цилиндр: вдоль оси Y, openEnded (без торцов — меньше граней
    // и нет z-fighting на стыках соседних сегментов).
    templateGeom = new THREE.CylinderGeometry(
      FILAMENT_RADIUS,
      FILAMENT_RADIUS,
      1,
      RADIAL_SEGMENTS,
      1,
      true, // openEnded
    );

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
    if (extrudeObj) {
      (extrudeObj.material as THREE.Material).dispose();
      scene?.remove(extrudeObj);
      extrudeObj = null;
    }
    if (progressObj) {
      (progressObj.material as THREE.Material).dispose();
      scene?.remove(progressObj);
      progressObj = null;
    }
    if (travelObj) {
      travelObj.geometry.dispose();
      (travelObj.material as THREE.Material).dispose();
      scene?.remove(travelObj);
      travelObj = null;
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

    instancesUpToLayer = null;
    extrudePrefix = null;
  }

  function buildMeshes(): void {
    if (!scene || !templateGeom) return;

    const n = parsed.moveCount;
    const pos = parsed.positions;

    // 1. Сбор экструзионных сегментов (они уже отсортированы по слоям в parsed)
    type Seg = {
      sx: number; sy: number; sz: number;
      ex: number; ey: number; ez: number;
      r: number; g: number; b: number;
    };
    const segments: Seg[] = [];
    const layerEndInstance: number[] = [];

    // parsed.positions — плоский массив [x1, y1, z1, x2, y2, z2, ...]
    // world маппинг: X=px, Y=pz (высота), Z=py (как было в LineSegments-версии)
    let curLayer = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      if (parsed.kinds[i] !== 1) continue;

      const sx = pos[o]!;
      const sz = pos[o + 1]!;
      const sy = pos[o + 2]!;
      const ex = pos[o + 3]!;
      const ez = pos[o + 4]!;
      const ey = pos[o + 5]!;

      const [r, g, b] = colorMode === 'extruder'
        ? extruderRgb(parsed.extruders[i] ?? 0)
        : typeRgb(parsed.segTypes[i] ?? 0);

      segments.push({ sx, sy, sz, ex, ey, ez, r, g, b });

      const l = parsed.layers[i] ?? 0;
      while (curLayer <= l) {
        layerEndInstance[curLayer] = segments.length;
        curLayer++;
      }
    }
    while (curLayer < Math.max(1, parsed.layerZ?.length ?? 1)) {
      layerEndInstance[curLayer] = segments.length;
      curLayer++;
    }

    const instanceCount = Math.max(1, segments.length);

    // 2. Основной InstancedMesh с Lambert-материалом (читается объём колбаски)
    const eMat = new THREE.MeshLambertMaterial();
    const inst = new THREE.InstancedMesh(templateGeom, eMat, instanceCount);
    inst.frustumCulled = false; // инстансы разбросаны по сцене, cull дорого

    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();

    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!;
      const dx = s.ex - s.sx;
      const dy = s.ey - s.sy;
      const dz = s.ez - s.sz;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

      dummy.position.set(
        (s.sx + s.ex) / 2,
        (s.sy + s.ey) / 2,
        (s.sz + s.ez) / 2,
      );

      if (len > 1e-6) {
        dir.set(dx / len, dy / len, dz / len);
        // Degenerate case: направление противоположно up → кватернион 180°
        if (Math.abs(dir.y + 1) < 1e-6) {
          dummy.quaternion.set(0, 0, 1, 0);
        } else {
          dummy.quaternion.setFromUnitVectors(up, dir);
        }
      } else {
        dummy.quaternion.identity();
      }

      dummy.scale.set(1, Math.max(len, 1e-6), 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);

      tmpColor.setRGB(s.r / 255, s.g / 255, s.b / 255);
      inst.setColorAt(i, tmpColor);
    }

    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;

    extrudeObj = inst;
    instancesUpToLayer = new Uint32Array(layerEndInstance);
    scene.add(inst);

    // 3. Progress overlay: тот же template, белый полупрозрачный материал,
    //    те же трансформации (clone array, чтобы не связывать lifecycle).
    const pMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    const pInst = new THREE.InstancedMesh(templateGeom, pMat, instanceCount);
    pInst.instanceMatrix = new THREE.InstancedBufferAttribute(
      new Float32Array(inst.instanceMatrix.array),
      16,
    );
    pInst.instanceMatrix.needsUpdate = true;
    pInst.renderOrder = 10;
    pInst.frustumCulled = false;
    pInst.visible = false;
    progressObj = pInst;
    scene.add(pInst);

    // 4. Префикс-сумма экструзионных сегментов по move-индексу (для progressSeg)
    const prefix = new Uint32Array(n + 1);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      prefix[i] = acc;
      if (parsed.kinds[i] === 1) acc++;
    }
    prefix[n] = acc;
    extrudePrefix = prefix;

    // 5. Travel — LineSegments (без объёма, тонкая полупрозрачная линия)
    let travCount = 0;
    for (let i = 0; i < n; i++) if (parsed.kinds[i] !== 1) travCount++;

    const tPos = new Float32Array(travCount * 6);
    let wt = 0;
    for (let i = 0; i < n; i++) {
      if (parsed.kinds[i] === 1) continue;
      const o = i * 6;
      const wo = wt * 6;
      tPos[wo] = pos[o]!;         tPos[wo + 1] = pos[o + 2]!; tPos[wo + 2] = pos[o + 1]!;
      tPos[wo + 3] = pos[o + 3]!; tPos[wo + 4] = pos[o + 5]!; tPos[wo + 5] = pos[o + 4]!;
      wt++;
    }

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
      fill.rotation.x = Math.PI / 2;
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
    if (!extrudeObj || !instancesUpToLayer) return;
    const idx = Math.min(l, instancesUpToLayer.length - 1);
    // InstancedMesh.count — это draw range по инстансам; быстрая операция.
    extrudeObj.count = instancesUpToLayer[idx] ?? 0;
  }

  function updateExcludeButtons(): void {
    if (!camera || !wrapEl) { buttonPositions = []; return; }
    const w = wrapSize.w || wrapEl.clientWidth;
    const h = wrapSize.h || wrapEl.clientHeight;
    if (!w || !h) { buttonPositions = []; return; }

    camera.updateMatrixWorld();

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

  $effect(() => {
    initThree();
    const wrap = wrapEl;
    const ro = new ResizeObserver(onResize);
    if (wrap) ro.observe(wrap);

    return () => {
      threeReady = false;
      ro.disconnect();
      clearMeshes();
      if (templateGeom) { templateGeom.dispose(); templateGeom = null; }
      if (ambientLight) scene?.remove(ambientLight);
      if (dirLight) scene?.remove(dirLight);
      ambientLight = null;
      dirLight = null;
      controls?.dispose();
      renderer?.dispose();
      controls = null;
      renderer = null;
      scene = null;
      camera = null;
    };
  });

  $effect(() => {
    void parsed;
    fitCamera();
    render();
  });

  $effect(() => {
    void parsed;
    void colorMode;
    buildMeshes();
    applyLayer(untrack(() => layer));
    render();
    return () => clearMeshes();
  });

  $effect(() => {
    applyLayer(layer);
    render();
  });

  $effect(() => {
    if (travelObj) travelObj.visible = showTravel;
    render();
  });

  $effect(() => {
    if (!progressObj || !extrudePrefix) return;
    if (progressSeg == null) {
      progressObj.visible = false;
    } else {
      progressObj.visible = true;
      // Число экструзионных сегментов до progressSeg (включительно)
      progressObj.count = extrudePrefix[progressSeg + 1] ?? 0;
    }
    render();
  });

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
    background: var(--bg-surface-hover-no-override);
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
    color: var(--accent-text);
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