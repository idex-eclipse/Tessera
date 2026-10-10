/**
 * Universal confirmation dialog store (host UI infrastructure).
 *
 * Usage:
 *   const ok = await confirm({ title, message, danger: true });
 *   if (!ok) return;
 */

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let current = $state<ConfirmRequest | null>(null);

/**
 * Opens the confirmation dialog and resolves when the user answers.
 * If a dialog is already open, the previous one resolves `false`.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (current) {
    current.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    current = { ...options, resolve };
  });
}

/**
 * Called by the dialog component.
 */
export function settleConfirm(ok: boolean): void {
  const request = current;
  current = null;

  if (request) {
    request.resolve(ok);
  }
}

export function getConfirmRequest(): ConfirmRequest | null {
  return current;
}