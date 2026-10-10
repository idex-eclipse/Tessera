import { mount, unmount, type Component } from 'svelte';

import MpuBridge from './MpuBridge.svelte';

export function defineMpuElement(tag: string, Comp: Component<any>): void {
  if (customElements.get(tag)) return;

  class MpuHostElement extends HTMLElement {
    #api: unknown = null;
    #params: Record<string, string> = {};
    #ctx: object | null = null;

    set api(v: unknown) { this.#api = v; }
    get api(): unknown { return this.#api; }

    set params(v: Record<string, string>) { this.#params = v ?? {}; }
    get params(): Record<string, string> { return this.#params; }

    connectedCallback(): void {
      if (this.#ctx) return;
      const self = this;
      this.#ctx = mount(MpuBridge, {
        target: this,
        props: {
          Component: Comp,
          get api() { return self.#api; },
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