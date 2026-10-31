import { mount, unmount } from 'svelte';

import Loader from './Loader.svelte';

/**
 * `<tessera-loader size="sm|md|lg" text="…" inline block>` — тот же загрузчик для
 * удалённых плагинов (они не могут импортировать Svelte-компоненты хоста).
 * Стили Loader изолированы Svelte-классами, Shadow DOM не нужен.
 */
export function defineTesseraLoaderElement(): void {
  if (typeof customElements === 'undefined' || customElements.get('tessera-loader')) return;

  class TesseraLoaderElement extends HTMLElement {
    static observedAttributes = ['size', 'text', 'inline', 'block'];
    #ctx: object | null = null;

    #props() {
      const size = this.getAttribute('size');
      return {
        size: (size === 'sm' || size === 'lg' ? size : 'md') as 'sm' | 'md' | 'lg',
        text: this.getAttribute('text') ?? undefined,
        inline: this.hasAttribute('inline'),
        block: this.hasAttribute('block'),
      };
    }

    #render(): void {
      if (this.#ctx) unmount(this.#ctx);
      this.#ctx = mount(Loader, { target: this, props: this.#props() });
    }

    connectedCallback(): void {
      if (!this.#ctx) this.#render();
    }

    attributeChangedCallback(): void {
      if (this.#ctx) this.#render();
    }

    disconnectedCallback(): void {
      if (this.#ctx) unmount(this.#ctx);
      this.#ctx = null;
    }
  }

  customElements.define('tessera-loader', TesseraLoaderElement);
}
