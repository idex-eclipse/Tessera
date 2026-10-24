import { mount, unmount, type Component } from 'svelte';

import MpuBridge from './MpuBridge.svelte';
import type { MpuParams, PluginApi } from '../types';

export function defineMpuElement(tag: string, Comp: Component<{ params?: MpuParams }>): void {
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
          Component: Comp,
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