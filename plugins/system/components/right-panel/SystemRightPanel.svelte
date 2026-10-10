<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte.ts';
  import KlippyNotReadyChip from '../../../shared/klippy-state/KlippyNotReadyChip.svelte';

  import Icon from '../../../shared/icons/Icon.svelte';
  import ConfirmDialog from '../../../shared/confirm-dialog.svelte';
  import ThreeMFInspector from '../../../shared/3mf-parser/3Mf-Inspector.svelte';
  import { openThreeMF } from '../../../shared/3mf-parser/parser.ts';
  import type { ThreeMFHandle } from '../../../shared/3mf-parser/types.ts';

  import { useSystem } from '../../use-system.svelte.ts';
  import { systemUiState } from '../../system-ui-state.svelte.ts';

  import { useNotifications } from '../../use-notifications.svelte.ts';
  import ToastStack from '../overlays/ToastStack.svelte';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useSystem(api);
  const notifications = useNotifications(api);
  const klippy = useKlippyState(api);

  // ------------------------------------------------------------------
  // collapsed: params хоста + data-collapsed (паттерн баннеров)
  // ------------------------------------------------------------------

  let rootEl = $state<HTMLElement | null>(null);
  let collapsedAttr = $state(false);

  $effect(() => {
    const el = rootEl?.closest('mpu-system-right-panel') as HTMLElement | null;
    if (!el) return;

    const read = () => {
      collapsedAttr = el.dataset.collapsed === 'true';
    };
    read();

    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ['data-collapsed'] });
    return () => mo.disconnect();
  });

  let collapsed = $derived(collapsedAttr || params.collapsed === 'true');

  // ------------------------------------------------------------------
  // аккордеоны Host / Services (персист в api.settings → sync)
  // ------------------------------------------------------------------

  let hostOpen = $state(api.settings.get<boolean>('panel:hostOpen') ?? false);
  let servicesOpen = $state(api.settings.get<boolean>('panel:servicesOpen') ?? false);
  let powerOpen = $state(api.settings.get<boolean>('panel:powerOpen') ?? false);

  function togglePower(): void {
    powerOpen = !powerOpen;
    api.settings.set('panel:powerOpen', powerOpen);
  }

  function toggleHost(): void {
    hostOpen = !hostOpen;
    api.settings.set('panel:hostOpen', hostOpen);
  }

  function toggleServices(): void {
    servicesOpen = !servicesOpen;
    api.settings.set('panel:servicesOpen', servicesOpen);
  }

  // печать — для locked_while_printing у power-устройств
  let printing = $state(false);

  $effect(() => {
    if (!api.printer.url) return;   // нет принтера — нет подписки
    return api.moonraker().subscribe(
      { print_stats: ['state'] },
      (d: any) => {
        const st = d?.print_stats?.state;
        if (typeof st === 'string') printing = st === 'printing' || st === 'paused';
      },
      { immediate: true },
    );
  });

  let accountsOpen = $state(api.settings.get<boolean>('panel:accountsOpen') ?? false);

  function toggleAccounts(): void {
    accountsOpen = !accountsOpen;
    api.settings.set('panel:accountsOpen', accountsOpen);
  }

  let currentUser = $derived(decodeJwtUser((api.moonraker() as { authToken?: string }).authToken ?? null));

  let newUserName = $state('');
  let newUserPass = $state('');
  let curPass = $state('');
  let newPass = $state('');

  function decodeJwtUser(tok: string | null): string | null {
    if (!tok) return null;
    try {
      const payload = tok.split('.')[1] ?? '';
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      return json?.sub ?? json?.username ?? null;
    } catch {
      return null;
    }
  }

  function doLogout(): void {
    window.dispatchEvent(
      new CustomEvent('mpu:auth-logout', { detail: { printerId: api.printer.id } }),
    );
  }

  // ------------------------------------------------------------------
  // подтверждения (все деструктивные, кроме E-stop)
  // ------------------------------------------------------------------

  interface ConfirmState {
    title: string;
    message: string;
    label: string;
    action: () => void;
  }

  let confirm = $state<ConfirmState | null>(null);

  function ask(title: string, message: string, label: string, action: () => void): void {
    confirm = { title, message, label, action };
  }

  // ------------------------------------------------------------------
  // upload & print
  // ------------------------------------------------------------------

  let printAfter = $state(true);

  let printAfterShown = $derived(printAfter && klippy.ready);

  function onPrintAfterChange(e: Event): void {
    printAfter = (e.currentTarget as HTMLInputElement).checked;
  }

  let uploadProgress = $state<number | null>(null);
  let uploadError = $state('');

  let printSkipped = $state(false);
  let printSkippedTimer: ReturnType<typeof setTimeout> | null = null;

  function flagPrintSkipped(): void {
    printSkipped = true;
    if (printSkippedTimer) clearTimeout(printSkippedTimer);
    printSkippedTimer = setTimeout(() => {
      printSkipped = false;
      printSkippedTimer = null;
    }, 6000);
  }

  let fileInputEl = $state<HTMLInputElement | null>(null);

  // ------------------------------------------------------------------
  // 3MF Inspector
  // ------------------------------------------------------------------

  let inspectorHandle = $state<ThreeMFHandle | null>(null);
  let inspectorOpen = $state(false);
  let inspectorBusy = $state(false);

  async function handleThreeMF(file: File): Promise<void> {
    if (uploadProgress !== null) return;
    
    uploadError = '';
    try {
      const handle = await openThreeMF(file);
      inspectorHandle = handle;
      inspectorOpen = true;
    } catch (err) {
      uploadError = i18n.t('system.uploadPrint.parseFailed');
    }
  }

  async function handleUpload(plateId: number): Promise<void> {
    if (!inspectorHandle || inspectorBusy) return;
    
    const plate = inspectorHandle.inspection.plates.find((p) => p.id === plateId);
    if (!plate?.gcodePath) return;

    inspectorBusy = true;
    try {
      const blob = await inspectorHandle.plateGcode(plateId);
      const filename = `${inspectorHandle.inspection.vendor}_plate${plateId}.gcode`;
      
      const fd = new FormData();
      fd.append('root', 'gcodes');
      fd.append('print', 'false');
      fd.append('file', blob, filename);

      const h = api.moonraker();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${h.httpBaseUrl}/server/files/upload`);
      const tok = (h as { authToken?: string }).authToken;
      if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`);

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error('upload_failed'));
        };
        xhr.onerror = () => reject(new Error('upload_error'));
        xhr.send(fd);
      });

      inspectorOpen = false;
      inspectorHandle = null;
    } catch {
      uploadError = i18n.t('system.uploadPrint.uploadFailed');
    } finally {
      inspectorBusy = false;
    }
  }

  async function handleUploadAndPrint(plateId: number): Promise<void> {
    if (!inspectorHandle || inspectorBusy || !klippy.ready) return;
    
    const plate = inspectorHandle.inspection.plates.find((p) => p.id === plateId);
    if (!plate?.gcodePath) return;

    inspectorBusy = true;
    try {
      const blob = await inspectorHandle.plateGcode(plateId);
      const filename = `${inspectorHandle.inspection.vendor}_plate${plateId}.gcode`;
      
      const fd = new FormData();
      fd.append('root', 'gcodes');
      fd.append('print', 'true');
      fd.append('file', blob, filename);

      const h = api.moonraker();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${h.httpBaseUrl}/server/files/upload`);
      const tok = (h as { authToken?: string }).authToken;
      if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`);

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error('upload_failed'));
        };
        xhr.onerror = () => reject(new Error('upload_error'));
        xhr.send(fd);
      });

      inspectorOpen = false;
      inspectorHandle = null;
    } catch {
      uploadError = i18n.t('system.uploadPrint.uploadFailed');
    } finally {
      inspectorBusy = false;
    }
  }

  function startUpload(file: File): void {
    // Перехват .3mf — открываем инспектор вместо загрузки
    if (file.name.toLowerCase().endsWith('.3mf')) {
      handleThreeMF(file);
      return;
    }

    if (uploadProgress !== null) return;

    uploadError = '';
    uploadProgress = 0;

    // FREEZE-матрица: upload есть всегда (Moonraker-level), print-шаг пропускаем,
    // если Klipper не ready. Guard здесь, а не в чекбоксе: свернутый rail и
    // drag&drop идут мимо развёрнутой секции.
    const willPrint = printAfter && klippy.ready;
    if (printAfter && !klippy.ready) flagPrintSkipped();

    const h = api.moonraker();
    const fd = new FormData();
    fd.append('root', 'gcodes');
    fd.append('print', willPrint ? 'true' : 'false');
    fd.append('file', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${h.httpBaseUrl}/server/files/upload`);

    const tok = (h as { authToken?: string }).authToken;
    if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) uploadProgress = Math.round((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      uploadProgress = null;
      if (xhr.status < 200 || xhr.status >= 300) {
        uploadError = i18n.t('system.uploadPrint.uploadFailed');
      }
    };
    xhr.onerror = () => {
      uploadProgress = null;
      uploadError = i18n.t('system.uploadPrint.uploadFailed');
    };
    xhr.send(fd);
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) startUpload(f);
  }

  function openNotifications(): void {
    systemUiState.notificationsOpen = !systemUiState.notificationsOpen;
  }

  let unseenCount = $derived(notifications.unseenCount);

  // Для оверлея инспектора: canPrint = klippy.ready && не печатает
  let canPrint = $derived(klippy.ready && !printing);
  let printHint = $derived(!klippy.ready ? i18n.t('common.klipperNotReady') : printing ? i18n.t('system.uploadPrint.printingBusy') : '');
</script>

<div class="sys-root" bind:this={rootEl}>
  {#if collapsed}
    <!-- ================= свёрнутый rail (стиль сайдбара) ================= -->
    <div class="rail">
      <button
        class="nav-item collapsed estop-item"
        disabled={!klippy.ready}
        onclick={() => store.estop()}
        title={!klippy.ready ? i18n.t('common.klipperNotReady') : i18n.t('system.eStop.title')}
      >
        <span class="nav-icon"><Icon name="estop" size={20}/></span>
      </button>

      <button
        class="nav-item collapsed"
        class:warn={!klippy.ready}
        disabled={uploadProgress !== null}
        onclick={() => fileInputEl?.click()}
        title={!klippy.ready
          ? `${i18n.t('system.uploadPrint.title')} — ${i18n.t('system.uploadUpload.printSkipped')}`
          : i18n.t('system.uploadPrint.title')}
      >
        <span class="nav-icon">
          {#if uploadProgress !== null}
            <span class="spinner" aria-hidden="true"></span>
          {:else}
            <Icon name="upload" size={20}/>
          {/if}
          {#if printSkipped}
            <span class="nav-badge warn-badge" title={i18n.t('system.uploadPrint.printSkipped')}>!</span>
          {/if}
        </span>
      </button>
    </div>
  {:else}
    <div class="sys-scroll">
      <!-- E-stop: без карточки-обёртки -->
      <button
        class="estop"
        disabled={!klippy.ready}
        title={!klippy.ready ? i18n.t('common.klipperNotReady') : undefined}
        onclick={() => store.estop()}
      >
        <Icon name="estop" size={20} />
        {i18n.t('system.eStop.label')}
      </button>

      <!-- Upload & print -->
      <section class="sec">
        <header class="sec-header">
          <span class="sec-title">{i18n.t('system.uploadPrint.title')}</span>
        </header>

        <div class="sec-body">
          {#if uploadProgress === null}
            <div
              class="dropzone"
              ondrop={onDrop}
              ondragover={(e) => e.preventDefault()}
              onclick={() => fileInputEl?.click()}
              role="button"
              tabindex="0"
              onkeydown={(e) => e.key === 'Enter' && fileInputEl?.click()}
            >
              <Icon name="upload" size={20} />
              <span class="dz-text">{i18n.t('system.uploadPrint.dropzone')}</span>
            </div>
          {:else}
            <div class="upload-progress">
              <div class="up-bar">
                <div class="up-fill" style="width: {uploadProgress}%"></div>
              </div>
              <span class="up-text">{uploadProgress}%</span>
            </div>
          {/if}

          {#if uploadError}
            <p class="error">{uploadError}</p>
          {/if}

          {#if printSkipped}
            <p class="notice-warn-line">{i18n.t('system.uploadPrint.printSkipped')}</p>
          {/if}

          <label class="check">
            <input
              type="checkbox"
              checked={printAfterShown}
              onchange={onPrintAfterChange}
              disabled={!klippy.ready}
            />
            {i18n.t('system.uploadPrint.printAfter')}
          </label>
          {#if !klippy.ready}
            <KlippyNotReadyChip />
          {/if}
        </div>
      </section>

      <!-- Host: аккордеон -->
      <section class="sec">
        <button
          class="sec-header acc-toggle"
          onclick={toggleHost}
          aria-expanded={hostOpen}
        >
          <span class="sec-title">{i18n.t('system.host.title')}</span>
          <span class="chev" class:open={hostOpen}>
            <Icon name="chevron-down" size={16} />
          </span>
        </button>

        <div class="acc-body" class:open={hostOpen}>
          <div class="acc-inner">
            <div class="sec-body btn-col">
              <button
                class="btn danger"
                disabled={store.busy !== ''}
                onclick={() =>
                  ask(
                    i18n.t('system.host.shutdown'),
                    i18n.t('system.host.shutdownConfirm'),
                    i18n.t('system.host.shutdown'),
                    () => store.hostShutdown(),
                  )}
              >
                <Icon name="power" size={14} />
                {i18n.t('system.host.shutdown')}
              </button>

              <button
                class="btn"
                disabled={store.busy !== ''}
                onclick={() =>
                  ask(
                    i18n.t('system.host.reboot'),
                    i18n.t('system.host.rebootConfirm'),
                    i18n.t('system.host.reboot'),
                    () => store.hostReboot(),
                  )}
              >
                <Icon name="refresh" size={14} />
                {i18n.t('system.host.reboot')}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Services: аккордеон, старт/стоп меняются по состоянию -->
      {#if store.systemInfo.availableServices.length > 0}
        <section class="sec">
          <button
            class="sec-header acc-toggle"
            onclick={toggleServices}
            aria-expanded={servicesOpen}
          >
            <span class="sec-title">{i18n.t('system.services.title')}</span>
            <span class="chev" class:open={servicesOpen}>
              <Icon name="chevron-down" size={16} />
            </span>
          </button>

          <div class="acc-body" class:open={servicesOpen}>
            <div class="acc-inner">
              <div class="sec-body rows">
                {#each store.systemInfo.availableServices as svc (svc)}
                  {@const st = store.systemInfo.serviceState[svc]}
                  {@const running = st?.active === 'active'}
                  <div class="row svc-row">
                    <div class="row-main">
                      <span class="row-name">{svc}</span>
                      <span
                        class="badge"
                        class:ok={running}
                        class:fail={st?.active === 'failed'}
                        class:off={st?.active === 'inactive'}
                      >
                        {st?.active ?? '—'}
                      </span>
                    </div>

                    <div class="row-actions">
                      <button
                        class="icon-btn"
                        disabled={store.busy !== ''}
                        title={i18n.t('system.services.restart')}
                        onclick={() =>
                          ask(
                            i18n.t('system.services.restart'),
                            i18n.t('system.services.confirmRestart', { name: svc }),
                            i18n.t('system.services.restart'),
                            () => store.serviceAction(svc, 'restart'),
                          )}
                      >
                        <Icon name="refresh" size={14} />
                      </button>

                      {#if running}
                        <button
                          class="icon-btn"
                          disabled={store.busy !== ''}
                          title={i18n.t('system.services.stop')}
                          onclick={() =>
                            ask(
                              i18n.t('system.services.stop'),
                              i18n.t('system.services.confirmStop', { name: svc }),
                              i18n.t('system.services.stop'),
                              () => store.serviceAction(svc, 'stop'),
                            )}
                        >
                          <Icon name="stop" size={14} />
                        </button>
                      {:else}
                        <button
                          class="icon-btn"
                          disabled={store.busy !== ''}
                          title={i18n.t('system.services.start')}
                          onclick={() =>
                            ask(
                              i18n.t('system.services.start'),
                              i18n.t('system.services.confirmStart', { name: svc }),
                              i18n.t('system.services.start'),
                              () => store.serviceAction(svc, 'start'),
                            )}
                        >
                          <Icon name="play" size={14} />
                        </button>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        </section>
      {/if}

      <!-- Power: аккордеон, по умолчанию закрыт -->
      {#if store.power.length > 0}
        <section class="sec">
          <button
            class="sec-header acc-toggle"
            onclick={togglePower}
            aria-expanded={powerOpen}
          >
            <span class="sec-title">{i18n.t('system.power.title')}</span>
            <span class="chev" class:open={powerOpen}>
              <Icon name="chevron-down" size={16} />
            </span>
          </button>

          <div class="acc-body" class:open={powerOpen}>
            <div class="acc-inner">
              <div class="sec-body rows">
                {#each store.power as dev (dev.device)}
                  {@const locked = dev.lockedWhilePrinting && printing}
                  <div class="row">
                    <div class="row-main">
                      <span class="row-name">{dev.device}</span>
                      <span class="row-sub">{dev.type}</span>
                    </div>
                    <button
                      class="power-toggle"
                      class:on={dev.status === 'on'}
                      disabled={locked || store.busy !== ''}
                      title={dev.status === 'on'
                        ? i18n.t('system.power.off')
                        : i18n.t('system.power.on')}
                      onclick={() => store.powerSet(dev.device, dev.status === 'on' ? 'off' : 'on')}
                    >
                      <Icon name="power" size={14} />
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        </section>
      {/if}
      {#if store.access.available}
        <section class="sec">
          <button class="sec-header acc-toggle" onclick={toggleAccounts} aria-expanded={accountsOpen}>
            <span class="sec-title">{i18n.t('system.accounts.title')}</span>
            <span class="chev" class:open={accountsOpen}>
              <Icon name="chevron-down" size={16} />
            </span>
          </button>

          <div class="acc-body" class:open={accountsOpen}>
            <div class="acc-inner">
              <div class="sec-body">
                {#if store.access.loginEnabled}
                  {#if currentUser}
                    <p class="acc-current">
                      {i18n.t('system.accounts.current', { user: currentUser })}
                    </p>
                  {/if}

                  <button class="btn danger" onclick={doLogout}>
                    <Icon name="logout" size={14} />
                    {i18n.t('system.accounts.logout')}
                  </button>
                {:else}
                  <!-- trusted-режим: юзеров можно создавать, логин не нужен -->
                  <p class="acc-current trusted">
                    {i18n.t('system.auth.trusted')}
                  </p>
                {/if}

                {#if store.access.users.length > 0}
                  <div class="rows users">
                    {#each store.access.users as u (u)}
                      <div class="row">
                        <span class="row-name">{u}</span>
                        <button
                          class="icon-btn"
                          title={i18n.t('system.accounts.delete')}
                          disabled={store.busy !== ''}
                          onclick={() =>
                            ask(
                              i18n.t('system.accounts.delete'),
                              i18n.t('system.accounts.confirmDelete', { name: u }),
                              i18n.t('system.accounts.delete'),
                              () => store.deleteUser(u),
                            )}
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}

                <div class="mini-form">
                  <input type="text" placeholder={i18n.t('system.auth.username')} bind:value={newUserName} />
                  <input type="password" placeholder={i18n.t('system.auth.password')} bind:value={newUserPass} />
                  <button
                    class="btn"
                    disabled={store.busy !== '' || !newUserName || !newUserPass}
                    onclick={() => {
                      store.addUser(newUserName, newUserPass);
                      newUserName = '';
                      newUserPass = '';
                    }}
                  >
                    <Icon name="plus" size={14} />
                    {i18n.t('system.accounts.add')}
                  </button>
                </div>

                {#if store.access.loginEnabled}
                  <div class="mini-form">
                    <input type="password" placeholder={i18n.t('system.accounts.currentPassword')} bind:value={curPass} />
                    <input type="password" placeholder={i18n.t('system.accounts.newPassword')} bind:value={newPass} />
                    <button
                      class="btn"
                      disabled={store.busy !== '' || !curPass || !newPass}
                      onclick={() => {
                        store.changePassword(curPass, newPass);
                        curPass = '';
                        newPass = '';
                      }}
                    >
                      {i18n.t('system.accounts.changePassword')}
                    </button>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </section>
      {/if}
    </div>
  {/if}
  <div class="sys-bottom">
    <button class="nav-item" class:collapsed onclick={openNotifications}>
      <span class="nav-icon">
        <Icon name="bell" size={20} />
        {#if unseenCount > 0}
          <span class="nav-badge">{unseenCount > 99 ? '99+' : unseenCount}</span>
        {/if}
      </span>
      {#if !collapsed}
        <span class="nav-label">{i18n.t('system.notifications.title')}</span>
      {/if}
    </button>
  </div>
</div>
<ToastStack />

<input
  type="file"
  accept=".gcode,.g,.gc,.gco,.3mf"
  hidden
  bind:this={fileInputEl}
  onchange={(e) => {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (f) startUpload(f);
    (e.currentTarget as HTMLInputElement).value = '';
  }}
/>

<ConfirmDialog
  open={confirm !== null}
  title={confirm?.title ?? ''}
  message={confirm?.message ?? ''}
  confirmLabel={confirm?.label ?? i18n.t('system.confirm')}
  danger={true}
  onConfirm={() => confirm?.action()}
  onClose={() => (confirm = null)}
/>

<ThreeMFInspector
  open={inspectorOpen}
  handle={inspectorHandle}
  busy={inspectorBusy}
  canPrint={canPrint}
  printHint={printHint}
  t={i18n.t}
  onClose={() => {
    inspectorOpen = false;
    inspectorHandle = null;
  }}
  onUpload={handleUpload}
  onUploadAndPrint={handleUploadAndPrint}
/>

<style>
  :global(mpu-system-right-panel) {
    display: block;
    height: 100%;
  }

  .sys-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .sys-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-md);
    animation: fade-in var(--transition-normal);
  }

  .sys-bottom {
    flex-shrink: 0;
    padding: 0 var(--space-sm);   /* низ больше не двойной: низ даёт футер хоста */
  }

  /* ======== точная копия паттерна plugin-sidebar ======== */
  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background var(--transition-fast), color var(--transition-fast);
    white-space: nowrap;
  }

  .nav-item:hover:not(:disabled) {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .nav-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .nav-item.collapsed {
    justify-content: center;
    padding-left: 0;
    padding-right: 0;
    gap: 0;
  }

  .nav-item.warn {
    color: var(--warning);
  }

  .nav-item.warn:hover:not(:disabled) {
    background: var(--bg-surface-hover);
    color: var(--warning);
  }

  .nav-badge.warn-badge {
    background: var(--warning);
  }

  .estop-item {
    color: var(--danger);
  }

  .estop-item:hover:not(:disabled) {
    background: var(--bg-surface-hover);
    color: var(--danger);
  }

  .nav-icon {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 30px;
    height: 30px;
  }

  .nav-icon :global(svg) {
    display: block;
  }

  .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nav-badge {
    position: absolute;
    top: -4px;
    inset-inline-end: -6px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--danger);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ---------------- свёрнутый rail: стиль сайдбара ----------------
     кнопки без фона, hover-подсветка, 30×30, svg 24×24 */

  .rail {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: var(--space-xs);
    animation: fade-in var(--transition-normal);
  }

  /* ---------------- E-stop: самостоятельная кнопка ---------------- */

  .estop {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    width: 100%;
    padding: var(--space-md);
    border: none;
    border-radius: var(--radius-md);
    background: var(--danger);
    color: #fff;
    font-size: var(--font-size-md);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    flex-shrink: 0;
    transition: filter var(--transition-fast), transform var(--transition-fast);
  }

  .estop:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .estop:active:not(:disabled) {
    transform: scale(0.98);
  }

  .estop:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: none;
  }

  /* ---------------- секции ---------------- */

  .sec {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    flex-shrink: 0;
  }

  .sec-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
  }

  /* заголовок-аккордеон: без нижней рамки, кликабельный */
  .sec-header.acc-toggle {
    width: 100%;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: start;
    transition: background var(--transition-fast);
  }

  .sec-header.acc-toggle:hover {
    background: var(--bg-surface-hover);
  }

  .chev {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-inline-start: auto;
    color: var(--text-muted);
    transform: rotate(-90deg);
    transition: transform var(--transition-fast);
    flex-shrink: 0;
  }

  .chev.open {
    transform: rotate(0deg);
  }

  /* плавное раскрытие через grid-rows */
  .acc-body {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows var(--transition-normal);
  }

  .acc-body.open {
    grid-template-rows: 1fr;
  }

  .acc-inner {
    overflow: hidden;
    min-height: 0;
  }

  .acc-body.open .acc-inner > .sec-body {
    border-top: 1px solid var(--border-color);
  }

  .sec-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sec-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
  }

  .sec-body.rows {
    gap: 0;
    padding: 0;
  }

  .sec-body.btn-col {
    padding: var(--space-sm) var(--space-md);
  }

  .btn {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover-no-override);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .btn:hover:not(:disabled) {
    background: var(--bg-surface-active);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.danger {
    border-color: color-mix(in srgb, var(--danger) 60%, transparent);
    color: var(--danger);
  }

  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-md);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-muted);
    cursor: pointer;
    transition: border-color var(--transition-fast), color var(--transition-fast);
  }

  .dropzone:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .dz-text {
    font-size: var(--font-size-sm);
    text-align: center;
  }

  .upload-progress {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .up-bar {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-surface-hover);
    overflow: hidden;
  }

  .up-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.15s linear;
  }

  .up-text {
    font-family: monospace;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    min-width: 38px;
    text-align: end;
  }

  .error {
    color: var(--danger);
    font-size: var(--font-size-sm);
    margin: 0;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-md);
    border-bottom: 1px solid var(--border-color);
  }

  .row:last-child {
    border-bottom: none;
  }

  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .row-name {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-sub {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-actions {
    display: flex;
    gap: var(--space-xs);
    flex-shrink: 0;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .icon-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .power-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--transition-fast);
    margin: var(--space-xs);
  }

  .power-toggle.on {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--bg-surface-active);
  }

  .power-toggle:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .badge {
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: var(--bg-surface-hover);
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .badge.ok {
    background: color-mix(in srgb, var(--success) 18%, transparent);
    color: var(--success);
  }

  .badge.fail {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
  }

  .badge.off {
    background: var(--bg-surface-hover);
    color: var(--text-muted);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

    .acc-current {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0;
  }

  .mini-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .mini-form input {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-app);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .mini-form input:focus {
    outline: none;
    border-color: var(--border-focus);
  }

  .users {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .acc-current.trusted {
    color: var(--text-muted);
    font-style: italic;
  }

  .notice-warn-line {
    color: var(--warning);
    font-size: var(--font-size-sm);
    margin: 0;
  }

</style>