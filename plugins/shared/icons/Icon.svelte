<script lang="ts">
  import { ICONS } from './icons';

  let { 
    name, 
    size = 16,
    cls = '',
    style = '',
  }: { 
    name: string; 
    size?: number;
    cls?: string; 
    style?: string 
  } = $props();

  //console.log(`[Icon] Load icon "${name}"`)

  if (!ICONS[name]) console.warn(`[Icon] unknown icon name: "${name}"`);
</script>

<svg
  class="mpu-icon {cls}"
  style={style || undefined}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {@html ICONS[name] ?? ICONS.file}
</svg>

<style>
  .mpu-icon { display: block; }
  .mpu-icon.spin :global(.blades) {
    animation: mpu-icon-spin var(--spin-d, 1.4s) linear infinite;
    transform-origin: 12px 12px;
  }
  @keyframes mpu-icon-spin { to { transform: rotate(360deg); } }
</style>