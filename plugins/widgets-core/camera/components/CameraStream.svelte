<script lang="ts">
  import { useWidget, useI18n } from '../../../../plugin-sdk/src/svelte/index';

  import type { WebcamItem } from '../use-cameras.svelte.ts';
  import { createFpsMeter } from '../camera-utils';

  let {
    camera,
    paused = false,
    variant = 'full',
    fps = $bindable(null),
  }: {
    camera: WebcamItem;
    /** остановить загрузку (например, пока поверх открыто окно просмотра) */
    paused?: boolean;
    /** thumb — лёгкое превью: низкий FPS, без тяжёлых потоков */
    variant?: 'full' | 'thumb';
    /** измеренный FPS; null — не измеряется для этого типа камеры */
    fps?: number | null;
  } = $props();

  const api = useWidget();
  const i18n = useI18n();

  const RETRY_MS = 3000;

  function resolveUrl(u: string): string {
    if (/^https?:\/\//i.test(u)) return u;
    try {
      const base = new URL(api.moonraker().httpBaseUrl);
      base.port = '';
      return base.origin + (u.startsWith('/') ? u : `/${u}`);
    } catch {
      return u;
    }
  }

  function bust(u: string): string {
    return u + (u.includes('?') ? '&' : '?') + '_cb=' + Date.now();
  }

  // adaptive — snapshot polling; img — multipart MJPEG / IP-camera;
  // video — HLS; iframe — HTTP-page
  type Kind = 'adaptive' | 'img' | 'video' | 'iframe' | 'unsupported';
  // poll — опрос snapshot; stream — поток в <img>; placeholder — превью без загрузки
  type Mode = 'poll' | 'stream' | 'video' | 'iframe' | 'unsupported' | 'placeholder';

  let kind = $derived<Kind>(
    camera.service === 'mjpegstreamer-adaptive'
      ? 'adaptive'
      : camera.service === 'hlsstream'
        ? 'video'
        : camera.service === 'iframe'
          ? 'iframe'
          : camera.service === 'go2rtc' || camera.service.startsWith('webrtc')
            ? 'unsupported'
            : 'img',
  );

  let mode = $derived.by<Mode>(() => {
    if (kind === 'adaptive') return 'poll';
    if (variant === 'thumb') return kind === 'img' && camera.snapshot_url ? 'poll' : 'placeholder';
    return kind === 'img' ? 'stream' : kind;
  });

  let wrapEl = $state<HTMLElement | null>(null);
  let videoEl = $state<HTMLVideoElement | null>(null);
  let visible = $state(true);
  let docHidden = $state(typeof document !== 'undefined' && document.hidden);
  let failed = $state(false);
  let src = $state('');
  let frameInFlight = false;

  let running = $derived(!paused && !docHidden);

  const meter = createFpsMeter();

  $effect(() => {
    const el = wrapEl;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      visible = es[0]?.isIntersecting ?? true;
    });
    io.observe(el);
    return () => io.disconnect();
  });

  $effect(() => {
    const onVis = () => (docHidden = document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  });

  $effect(() => {
    failed = false;
    meter.reset();
    frameInFlight = false;

    if (!running || mode === 'unsupported' || mode === 'placeholder') {
      src = '';
      return;
    }

    if (mode === 'poll') {
      const raw = variant === 'thumb' || !visible ? camera.target_fps_idle : camera.target_fps;
      const rate = Math.max(1, Math.round(Number.isFinite(raw) ? raw : 5));
      const load = () => {
        if (frameInFlight) return;
        frameInFlight = true;
        src = bust(resolveUrl(camera.snapshot_url));
      };
      load();
      const iv = setInterval(load, Math.round(1000 / rate));
      return () => clearInterval(iv);
    }

    src = resolveUrl(camera.stream_url);
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };
  });

  // Потоки (stream/video) сами не переподключаются: после ошибки пробуем снова
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function onStreamError(): void {
    failed = true;
    if (retryTimer || !running) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      src = bust(resolveUrl(camera.stream_url));
    }, RETRY_MS);
  }

  // FPS публикуем только там, где он измерим, и только для основного вида
  $effect(() => {
    if (variant === 'thumb' || !running || (mode !== 'poll' && mode !== 'video')) {
      fps = null;
      return;
    }
    const iv = setInterval(() => (fps = meter.fps()), 500);
    return () => {
      clearInterval(iv);
      fps = null;
    };
  });

  $effect(() => {
    const el = videoEl;
    if (!el || !running || typeof el.requestVideoFrameCallback !== 'function') return;
    let id = 0;
    const cb = () => {
      meter.tick();
      id = el.requestVideoFrameCallback(cb);
    };
    id = el.requestVideoFrameCallback(cb);
    return () => el.cancelVideoFrameCallback(id);
  });

  let rotated = $derived(camera.rotation === 90 || camera.rotation === 270);

  let transform = $derived(
    [
      camera.rotation ? `rotate(${camera.rotation}deg)` : '',
      camera.flip_horizontal ? 'scaleX(-1)' : '',
      camera.flip_vertical ? 'scaleY(-1)' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
</script>

<div class="cam" bind:this={wrapEl}>
  {#if mode === 'unsupported'}
    <div class="cam-off">{i18n.t('widgets.camera.webrtcUnsupported')}</div>
  {:else if mode === 'placeholder'}
    <div class="cam-off">
      <bdi>{camera.name}</bdi>
      <div class="cam-sub">{i18n.t('widgets.camera.noPreview')}</div>
    </div>
  {:else if mode === 'iframe'}
    {#if src}
      <iframe class="cam-frame" {src} title={camera.name}></iframe>
    {/if}
  {:else if mode === 'video'}
    {#if src}
      <video
        bind:this={videoEl}
        class="cam-media"
        class:rot={rotated}
        style:transform={transform || undefined}
        {src}
        autoplay
        muted
        playsinline
        onerror={onStreamError}
        onplaying={() => (failed = false)}
      ></video>
    {/if}
  {:else if src}
    <img
      class="cam-media"
      class:rot={rotated}
      style:transform={transform || undefined}
      {src}
      alt={camera.name}
      onerror={() => {
        frameInFlight = false;
        if (mode === 'stream') onStreamError();
        else failed = true;
      }}
      onload={() => {
        failed = false;
        frameInFlight = false;
        if (mode === 'poll') meter.tick();
      }}
    />
  {/if}

  {#if failed && mode !== 'iframe'}
    <div class="cam-off cam-overlay">{i18n.t('widgets.camera.offline')}</div>
  {/if}
</div>

<style>
  .cam {
    position: relative;
    width: 100%;
    height: 100%;
    background: transparent;
    border-radius: var(--radius-sm);
    overflow: hidden;
    container-type: size;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cam-media {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  /* после поворота на 90°/270° ширина и высота меняются местами */
  .cam-media.rot {
    max-width: 100cqh;
    max-height: 100cqw;
  }

  .cam-frame {
    width: 100%;
    height: 100%;
    border: none;
    background: #000;
  }

  .cam-off {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
    padding: var(--space-md);
  }

  .cam-sub {
    font-size: var(--font-size-xs);
    opacity: 0.7;
  }

  .cam-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-surface);
  }
</style>
