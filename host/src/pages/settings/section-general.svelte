<script lang="ts">
  import { getAppContext } from '../../app-context.ts';
  import { CORE_LOCALE_OPTIONS } from '../../i18n/index.ts';
  import ColorPickerMenu from '../../../../plugins/shared/color-picker/ColorPickerMenu.svelte'
  import { FONT_MAX_BYTES } from '../../core/settings-store.svelte.ts';

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

  // Validate the binary header because browsers often report empty or generic MIME types.
  const FONT_FORMATS: Record<string, { magic: number[]; mime: string }> = {
    woff2: { magic: [0x77, 0x4f, 0x46, 0x32], mime: 'woff2' },
    woff: { magic: [0x77, 0x4f, 0x46, 0x46], mime: 'woff' },
    ttf: { magic: [0x00, 0x01, 0x00, 0x00], mime: 'ttf' },
    otf: { magic: [0x4f, 0x54, 0x54, 0x4f], mime: 'otf' },
  };
  let fontFileEl = $state<HTMLInputElement | null>(null);
  let fontBusy = $state(false);
  let fontError = $state('');

  /** Decode before saving so a corrupt file never replaces the working font. */
  async function onFontFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    fontError = '';
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const format = FONT_FORMATS[extension];
    if (!format) { fontError = i18n.t('settings.fontInvalid'); return; }
    if (file.size > FONT_MAX_BYTES) { fontError = i18n.t('settings.fontTooLarge'); return; }
    fontBusy = true;
    try {
      const bytes = await file.arrayBuffer();
      const header = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
      if (!format.magic.every((byte, at) => header[at] === byte)) throw new Error('font signature');
      const face = new FontFace('Tessera Custom', bytes);
      await face.load();
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      if (!data || !await ui.setCustomFont({ name: file.name, dataUrl: `data:font/${format.mime};base64,${data}` })) {
        fontError = i18n.t('settings.fontSaveFailed');
      }
    } catch {
      fontError = i18n.t('settings.fontInvalid');
    } finally {
      fontBusy = false;
    }
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
    <label class="row-label" for="high-contrast">{i18n.t('settings.highContrast')}</label>
    <input id="high-contrast" type="checkbox" checked={ui.highContrast} onchange={(e) => ui.setHighContrast(e.currentTarget.checked)} />
  </div>

  <div class="row">
    <label class="row-label" for="font-scale">{i18n.t('settings.fontScale')}</label>
    <div class="font-controls">
      <input id="font-scale" type="range" min="80" max="150" step="10" value={ui.fontScale} oninput={(e) => ui.setFontScale(Number(e.currentTarget.value))} />
      <output for="font-scale" dir="ltr">{ui.fontScale}%</output>
    </div>
  </div>

  <div class="row">
    <label class="row-label" for="letter-spacing">{i18n.t('settings.letterSpacing')}</label>
    <div class="font-controls">
      <input id="letter-spacing" type="range" min="0" max="12" step="2" value={ui.letterSpacing} oninput={(e) => ui.setLetterSpacing(Number(e.currentTarget.value))} />
      <output for="letter-spacing" dir="ltr">+{ui.letterSpacing / 100}em</output>
    </div>
  </div>

  <div class="row">
    <label class="row-label" for="glyph-width">{i18n.t('settings.glyphWidth')}</label>
    <div class="font-controls">
      <input id="glyph-width" type="range" min="0" max="6" step="1" value={ui.glyphWidth} oninput={(e) => ui.setGlyphWidth(Number(e.currentTarget.value))} />
      <output for="glyph-width" dir="ltr">+{ui.glyphWidth / 100}em</output>
    </div>
  </div>

  <div class="row">
    <span class="row-label">{i18n.t('settings.customFont')}</span>
    <div class="font-controls">
      {#if ui.customFont}<span class="font-name" title={ui.customFont.name} dir="auto">{ui.customFont.name}</span>{/if}
      <button class="btn" disabled={fontBusy} onclick={() => fontFileEl?.click()}>{fontBusy ? i18n.t('common.loading') : i18n.t('settings.fontUpload')}</button>
      {#if ui.customFont}<button class="btn" disabled={fontBusy} onclick={() => void ui.setCustomFont(null)}>{i18n.t('common.reset')}</button>{/if}
    </div>
  </div>
  {#if fontError}<p class="error" role="alert">{fontError}</p>{/if}
  <input hidden type="file" accept=".woff2,.woff,.ttf,.otf" bind:this={fontFileEl} onchange={onFontFile} />

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
              if (!hex) return;
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
  .row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-md); }
  .accent-row { align-items: flex-start; }
  .row-label { color: var(--text-secondary); }
  /* Controls wrap in RTL and at narrow widths without hiding long file names. */
  .font-controls { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-sm); min-width: 0; max-width: 100%; }
  .font-controls input[type='range'] { max-width: min(45vw, 220px); }
  .font-controls input[type='range'] { min-height: var(--touch-target); accent-color: var(--accent); }
  #high-contrast { width: 24px; height: 24px; margin: 10px; accent-color: var(--accent); }
  .font-controls .btn { min-height: var(--touch-target); }
  .font-controls output { min-width: 7ch; text-align: end; }
  .font-name { max-width: min(45vw, 220px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .seg { display: flex; border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; }
  .seg button { padding: var(--space-sm) var(--space-lg); border: none; background: transparent; color: var(--text-secondary); cursor: pointer; }
  .seg button.active { background: var(--bg-surface-active); color: var(--accent); }
  :global([data-contrast='high']) .seg button.active { background: var(--accent); color: var(--accent-text); }
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
  .preset.custom .label { font-size: var(--font-size-compact); font-weight: 600; line-height: 1; }

  .picker-popover {
    position: absolute;
    top: calc(100% + 6px);
    inset-inline-end: 0;
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
