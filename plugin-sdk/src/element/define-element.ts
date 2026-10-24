import { mount, unmount, type Component } from 'svelte';

import MpuBridge from './MpuBridge.svelte';
import type { MpuParams, PluginApi } from '../types';

/**
 * Регистрирует Custom Element поверх Svelte-компонента. Компонент может объявлять
 * проп `params` (MpuParams) или не иметь пропсов вовсе — поэтому тип пропсов
 * обобщённый, а не фиксированный.
 */
export function defineMpuElement<P extends Record<string, any>>(tag: string, Comp: Component<P>): void {
  // Вне браузера (node/SSR, тесты) регистрировать нечего.
  if (typeof customElements === 'undefined' || customElements.get(tag)) return;

  class MpuHostElement extends HTMLElement {
    #api: PluginApi | null = null;
    #params: MpuParams = {};
    #ctx: object | null = null;

    set api(v: PluginApi | null) { this.#api = v; }
    get api(): PluginApi | null { return this.#api; }

    set params(v: MpuParams) { this.#params = v ?? {}; }
    get params(): MpuParams { return this.#params; }

    connectedCallback(): void {
      if (this.#ctx) return;
      const self = this;
      this.#ctx = mount(MpuBridge, {
        target: this,
        props: {
          Component: Comp as Component<any>,
          get api() { return self.#api as PluginApi; },
          get params() { return self.#params; },
        },
      });
    }

    disconnectedCallback(): void {
      const ctx = this.#ctx;
      this.#ctx = null;
      if (ctx) unmount(ctx);
    }
  }

  customElements.define(tag, MpuHostElement);
}