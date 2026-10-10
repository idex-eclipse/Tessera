<script lang="ts">
  import { getAppContext } from '../../app-context.ts';
  import { CORE_LOCALE_OPTIONS } from '../../i18n/index.ts';
  import ColorPickerMenu from '../../../../plugins/shared/color-picker/ColorPickerMenu.svelte'

  const { ui, i18n } = getAppContext();

  function setLocale(code: string): void {
    const opt = CORE_LOCALE_OPTIONS.find((o) => o.code === code);
    i18n.setLocale(code, opt?.dir);
  }

  // ---------------- фоновая картинка ----------------
  let fileEl = $state<HTMLInputElement | null>(null);
  let busy = $state(false);
  let error = $state('');

  const MAX_SRC_BYTES = 8 * 1024 * 1024;
  const MAX_OUT_PX = 1920;
  const QUALITY = 0.82;

  function pickFile(): void {
    error = '';
    fileEl?.click();
  }

  async function onFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      error = i18n.t('settings.bgImageUnsupported');
      return;
    }
    if (file.size > MAX_SRC_BYTES) {
      error = i18n.t('settings.bgImageTooLarge');
      return;
    }
    busy = true;
    try {
      const url = await downscaleToDataUrl(file);
      if (!ui.setBackgroundImage(url)) {
        error = i18n.t('settings.bgImageTooLarge');
      }
    } catch {
      error = i18n.t('settings.bgImageUnsupported');
    } finally {
      busy = false;
    }
  }

  function downscaleToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objUrl);
        const scale = Math.min(1, MAX_OUT_PX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('no 2d context')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        const webp = canvas.toDataURL('image/webp', QUALITY);
        resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', QUALITY));
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('decode failed')); };
      img.src = objUrl;
    });
  }

  function removeBg(): void {
    error = '';
    ui.setBackgroundImage(null);
  }

  // ---------------- акцентный цвет ----------------
  type AccentPreset = { id: string; color: string; labelKey: string };

  const PRESETS: AccentPreset[] = [
    { id: 'blue',   color: '#4285f4', labelKey: 'settings.accentPresets.blue' },
    { id: 'green',  color: '#34a853', labelKey: 'settings.accentPresets.green' },
    { id: 'purple', color: '#9c27b0', labelKey: 'settings.accentPresets.purple' },
    { id: 'orange', color: '#ff6d00', labelKey: 'settings.accentPresets.orange' },
    { id: 'red',    color: '#ea4335', labelKey: 'settings.accentPresets.red' },
    { id: 'teal',   color: '#00897b', labelKey: 'settings.accentPresets.teal' },
  ];

  let pickerOpen = $state(false);
  let customValue = $state(ui.accent ?? '#4285f4');

  // текущий выбор: preset.id | 'custom' | 'default'
  let currentChoice = $derived.by<'default' | 'custom' | string>(() => {
    if (ui.accent === null) return 'default';
    const hit = PRESETS.find((p) => p.color === ui.accent);
    return hit ? hit.id : 'custom';
  });

  function selectPreset(preset: AccentPreset): void {
    error = '';
    ui.setAccent(preset.color);
    customValue = preset.color;
  }

  function applyCustom(): void {
    error = '';
    if (!/^#[0-9a-fA-F]{6}$/.test(customValue)) {
      error = i18n.t('settings.accentInvalid');
      return;
    }
    ui.setAccent(customValue);
  }

  function resetAccent(): void {
    error = '';
    ui.setAccent(null);
  }
</script>

<div class="section">
  <div class="row">
    <span class="row-label">{i18n.t('settings.theme')}</span>
    <div class="seg">
      <button class:active={ui.theme === 'light'} onclick={() => ui.setTheme('light')}>
        {i18n.t('settings.themeLight')}
      </button>
      <button class:active={ui.theme === 'dark'} onclick={() => ui.setTheme('dark')}>
        {i18n.t('settings.themeDark')}
      </button>
    </div>
  </div>

  <div class="row">
    <span class="row-label">{i18n.t('settings.language')}</span>
    <select value={i18n.locale} onchange={(e) => setLocale(e.currentTarget.value)}>
      {#each CORE_LOCALE_OPTIONS as o (o.code)}
        <option value={o.code}>{o.nativeName}</option>
      {/each}
    </select>
  </div>

  <div class="row accent-row">
    <span class="row-label">{i18n.t('settings.accent')}</span>
    <div class="accent-controls">
      <div class="presets" role="radiogroup" aria-label={i18n.t('settings.accent')}>
        {#each PRESETS as p (p.id)}
          <button
            class="preset"
            class:active={currentChoice === p.id}
            style:background={p.color}
            title={i18n.t(p.labelKey)}
            aria-label={i18n.t(p.labelKey)}
            onclick={() => selectPreset(p)}
          ></button>
        {/each}
        <button
          class="preset custom"
          class:active={currentChoice === 'custom'}
          title={i18n.t('settings.accentCustom')}
          aria-label={i18n.t('settings.accentCustom')}
          onclick={() => (pickerOpen = !pickerOpen)}
        >
          <span class="swatch" style:background={currentChoice === 'custom' ? customValue : 'var(--bg-surface-active)'}></span>
          <span class="label">+</span>
        </button>
      </div>

      {#if pickerOpen}
        <div class="picker-popover">
          <ColorPickerMenu
            value={customValue}
            onPick={(hex) => {
              customValue = hex;
              applyCustom();
            }
            }
            i18n={i18n}
          />
        </div>
      {/if}

      {#if currentChoice !== 'default'}
        <button class="btn-link" onclick={resetAccent}>
          {i18n.t('settings.accentReset')}
        </button>
      {/if}
    </div>
  </div>

  <div class="row">
    <span class="row-label">{i18n.t('settings.bgImage')}</span>
    <div class="bg-controls">
      {#if ui.bgImage}
        <img class="bg-thumb" src={ui.bgImage} alt="" />
        <button class="btn" disabled={busy} onclick={removeBg}>
          {i18n.t('common.remove')}
        </button>
      {:else}
        <button class="btn" disabled={busy} onclick={pickFile}>
          {busy ? i18n.t('common.loading') : i18n.t('settings.bgImageUpload')}
        </button>
      {/if}
    </div>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <input hidden type="file" accept="image/*" bind:this={fileEl} onchange={onFile} />
</div>

<style>
  .section { display: flex; flex-direction: column; gap: var(--space-lg); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); }
  .accent-row { align-items: flex-start; }
  .row-label { color: var(--text-secondary); }
  .seg { display: flex; border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; }
  .seg button { padding: var(--space-sm) var(--space-lg); border: none; background: transparent; color: var(--text-secondary); cursor: pointer; }
  .seg button.active { background: var(--bg-surface-active); color: var(--accent); }
  select { padding: var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-primary); }

  .accent-controls { display: flex; flex-direction: column; gap: var(--space-sm); align-items: flex-end; position: relative; }
  .presets { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
  .preset {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--border-color);
    cursor: pointer;
    transition: transform var(--transition-fast), border-color var(--transition-fast);
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .preset:hover { transform: scale(1.08); }
  .preset.active { border-color: var(--text-primary); box-shadow: 0 0 0 2px var(--bg-surface), 0 0 0 4px var(--accent); }
  .preset.custom {
    background: var(--bg-surface-hover);
    color: var(--text-muted);
    gap: 2px;
  }
  .preset.custom .swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid var(--border-color);
  }
  .preset.custom .label { font-size: 14px; font-weight: 600; line-height: 1; }

  .picker-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: var(--space-sm);
  }

  .btn-link {
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: var(--font-size-sm);
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .btn-link:hover { color: var(--accent-hover); }

  .bg-controls { display: flex; align-items: center; gap: var(--space-sm); }
  .bg-thumb {
    width: 64px;
    height: 40px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    background: var(--bg-surface-hover);
  }
  .btn {
    padding: var(--space-sm) var(--space-lg);
    border: none;
    border-radius: var(--radius-md);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .error { color: var(--danger); font-size: var(--font-size-sm); margin: 0; }
</style>