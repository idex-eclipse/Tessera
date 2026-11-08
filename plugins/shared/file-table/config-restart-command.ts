import type { MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import type { KlippyState } from '../klippy-state/use-klippy-state.svelte.ts';
import type { FileRef } from './file-ops';

/**
 * Send one restart command for the saved config; the caller handles request errors.
 * @param target Moonraker connection for the printer that owns the file.
 * @param ref Saved file whose service determines the command.
 * @param klippyState Live state at the time Save & Restart was clicked.
 * @returns A promise for the command acknowledgement, not the new startup state.
 */
export async function sendConfigRestart(target: MoonrakerProxyHandle, ref: FileRef, klippyState: KlippyState = 'unknown'): Promise<void> {
  if (ref.root === 'config' && /^moonraker\.conf$/i.test(ref.path)) {
    await target.request('machine.services.restart', { service: 'moonraker' });
  } else if (klippyState === 'error') {
    // A startup failure can leave Klippy unable to answer its own restart endpoint.
    await target.request('machine.services.restart', { service: 'klipper' });
  } else {
    await target.request('printer.firmware_restart', {});
  }
}

/**
 * Dispatch a restart without keeping the editor busy while Moonraker waits for Klippy.
 * @param target Moonraker connection for the saved file.
 * @param ref Saved file whose service determines the command.
 * @param klippyState Live state at dispatch time.
 * @param onError Receives a later explicit command rejection.
 * @returns Nothing; completion and startup are not awaited.
 */
export function dispatchConfigRestart(
  target: MoonrakerProxyHandle,
  ref: FileRef,
  klippyState: KlippyState,
  onError: (error: unknown) => void,
): void {
  // The host guard can park a command for confirmation, so a UI timeout must not imply cancellation.
  void sendConfigRestart(target, ref, klippyState).catch(onError);
}
