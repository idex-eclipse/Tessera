<script lang="ts">
  import { useWidget, useI18n } from '../../../../plugin-sdk/src/svelte/index';

  import type { WebcamItem } from '../use-cameras.svelte.ts';

  let { camera }: { camera: WebcamItem } = $props();

  const api = useWidget();
  const i18n = useI18n();

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

  // adaptive — snapshot polling; img — multipart MJPEG / IP-camera;
  // video — HLS; iframe — HTTP-page
  type Kind = 'adaptive' | 'img' | 'video' | 'iframe' | 'unsupported';

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

  let wrapEl = $state<HTMLElement | null>(null);
  let visible = $state(true);
  let failed = $state(false);
  let src = $state('');
  let frameInFlight = false;

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
    failed = false;

    if (kind === 'adaptive') {
      const fps = Math.max(1, Math.round(visible ? camera.target_fps : camera.target_fps_idle));
      frameInFlight = false;
      const load = () => {
        if (frameInFlight) return;
        frameInFlight = true;
        const base = resolveUrl(camera.snapshot_url);
        src = base + (base.includes('?') ? '&' : '?') + '_cb=' + Date.now();
      };
      load();
      const iv = setInterval(load, Math.round(1000 / fps));
      return () => clearInterval(iv);
    }

    if (kind === 'unsupported') {
      src = '';
      return;
    }

    src = resolveUrl(camera.stream_url);
    return;
  });

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
  {#if kind === 'unsupported'}
    <div class="cam-off">{i18n.t('widgets.camera.webrtcUnsupported')}</div>
  {:else if failed}
    <div class="cam-off">{i18n.t('widgets.camera.offline')}</div>
  {:else if kind === 'iframe'}
    <iframe class="cam-frame" src={src} title={camera.name}></iframe>
  {:else if kind === 'video'}
    <video
      class="cam-media"
      style:transform={transform || undefined}
      src={src}
      autoplay
      muted
      playsinline
      onerror={() => (failed = true)}
    ></video>
  {:else}
    <img
      class="cam-media"
      style:transform={transform || undefined}
      {src}
      alt={camera.name}
      onerror={() => { failed = true; frameInFlight = false; }}
      onload={() => { failed = false; frameInFlight = false; }}
    />
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
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cam-media {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
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
</style>