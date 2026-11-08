<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { extensionRef } from '../../core/extension-resolver';

  /**
   * Конфликт точки расширения: применимых вкладов больше ёмкости точки.
   * Пока пользователь не выбрал победителей, все конфликтующие вклады выключены.
   * «Позже» откладывает диалог до конца сессии (индикатор остаётся в Settings → Plugins).
   */
  const { extensions, i18n, loader } = getAppContext();

  let point = $derived(extensions.nextConflict);

  let selected = $state<string[]>([]);
  let lastAddress = '';

  $effect(() => {
    const a = point?.address ?? '';
    if (a !== lastAddress) {
      lastAddress = a;
      selected = [];
    }
  });

  let single = $derived(point ? point.capacity === 1 : true);

  function pluginName(pluginId: string): string {
    const m = loader.getLoadedPlugin(pluginId)?.manifest;
    return m ? `${m.name} ${m.version}` : pluginId;
  }

  function toggle(ref: string): void {
    if (!point) return;
    if (single) {
      selected = [ref];
      return;
    }
    if (selected.includes(ref)) selected = selected.filter((r) => r !== ref);
    else if (selected.length < point.capacity) selected = [...selected, ref];
  }

  function apply(): void {
    if (!point) return;
    extensions.resolveConflict(point.address, selected);
  }

  function later(): void {
    if (point) extensions.postponeConflict(point.address);
  }

  let ownerName = $derived(point ? (loader.getLoadedPlugin(point.owner)?.manifest.name ?? point.owner) : '');
  let pointTitle = $derived(point?.decl.titleKey ? i18n.t(point.decl.titleKey) : (point?.decl.id ?? ''));
</script>

{#if point}
  <div class="dialog-backdrop" role="presentation"></div>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="ext-conflict-title">
    <div class="dialog-header">
      <h3 id="ext-conflict-title">{i18n.t('extensions.conflict.title')}</h3>
    </div>

    <div class="dialog-body">
      <p class="where">{ownerName} → {pointTitle}</p>
      <p class="message">
        {single
          ? i18n.t('extensions.conflict.messageReplacement')
          : i18n.t('extensions.conflict.messageAppend', { max: point.capacity })}
      </p>

      <div class="options" role={single ? 'radiogroup' : 'group'}>
        {#each point.candidates as ext (extensionRef(ext))}
          {@const ref = extensionRef(ext)}
          <label class="option">
            <input
              type={single ? 'radio' : 'checkbox'}
              name="ext-conflict"
              checked={selected.includes(ref)}
              disabled={!single && !selected.includes(ref) && selected.length >= point.capacity}
              onchange={() => toggle(ref)}
            />
            <span class="option-title">{i18n.t(ext.contribution.titleKey)}</span>
            <span class="option-plugin">{pluginName(ext.pluginId)}</span>
          </label>
        {/each}
        {#if single}
          <label class="option">
            <input type="radio" name="ext-conflict" checked={selected.length === 0} onchange={() => (selected = [])} />
            <span class="option-title">{i18n.t('extensions.conflict.keepOriginal')}</span>
          </label>
        {/if}
      </div>

      <p class="hint">{i18n.t('extensions.conflict.hint')}</p>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={later}>{i18n.t('extensions.conflict.later')}</button>
      <button class="btn btn-primary" onclick={apply}>{i18n.t('extensions.conflict.apply')}</button>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: var(--bg-overlay);
    z-index: 300;
  }

  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 440px;
    max-height: 90dvh;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 301;
    overflow: hidden;
  }

  .dialog-header {
    padding: var(--space-md) var(--space-lg);
    border-bottom: 1px solid var(--border-color);
  }

  .dialog-header h3 {
    font-size: var(--font-size-lg);
    font-weight: 600;
  }

  .dialog-body {
    padding: var(--space-lg);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .where {
    margin: 0;
    font-weight: 600;
    color: var(--text-primary);
  }

  .message,
  .hint {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }

  .hint {
    color: var(--text-muted);
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .option {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-size-sm);
  }

  .option:hover {
    background: var(--bg-surface-hover);
  }

  .option-title {
    color: var(--text-primary);
  }

  .option-plugin {
    margin-inline-start: auto;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-sm);
    padding: var(--space-md) var(--space-lg);
    border-top: 1px solid var(--border-color);
  }

  .btn {
    padding: var(--space-sm) var(--space-lg);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--font-size-md);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .btn-primary {
    background: var(--accent);
    color: #fff;
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--border-color);
  }
</style>
