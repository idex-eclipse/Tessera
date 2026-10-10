/**
 * Minimal ambient declarations for Svelte 5 runes.
 *
 * The real transformation is done by the Svelte compiler.
 * This file only helps plain `tsc --noEmit` understand rune syntax
 * in .svelte.ts files.
 */

declare function $state<T>(initial: T): T;
declare function $state<T>(): T | undefined;

declare function $derived<T>(expression: T): T;

declare function $effect(fn: () => void | (() => void)): void;

declare function $props<T>(): T;

declare function $bindable<T>(initial?: T): T;