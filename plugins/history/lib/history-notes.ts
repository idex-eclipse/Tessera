import type { MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';

const NOTE_NAMESPACE = 'tessera_history';

/** Versioned database value that prevents a reused job id from inheriting an old note. */
interface StoredHistoryNote {
  v: 1;
  startTime: number;
  text: string;
  updatedAt: number;
}

/** Minimal Moonraker database response used by the note store. */
interface DatabaseItemResponse {
  value?: unknown;
}

/** A note plus whether a matching record currently exists in Moonraker. */
export interface LoadedHistoryNote {
  text: string;
  exists: boolean;
}

// Array keys keep all notes beneath one namespace branch without escaping job ids.
function noteKey(jobId: string): string[] {
  return ['notes', jobId];
}

// Moonraker versions use different messages for an absent database item.
function isMissingItem(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|does not exist|key.*exist|404/i.test(message);
}

/** Loads a note only when it belongs to the same job start time. */
export async function loadHistoryNote(
  moonraker: MoonrakerProxyHandle,
  jobId: string,
  startTime: number,
): Promise<LoadedHistoryNote> {
  try {
    const response = await moonraker.request<DatabaseItemResponse>('server.database.get_item', {
      namespace: NOTE_NAMESPACE,
      key: noteKey(jobId),
    });
    const value = response.value;
    if (!value || typeof value !== 'object') return { text: '', exists: false };
    const note = value as Partial<StoredHistoryNote>;
    if (note.v !== 1 || note.startTime !== startTime || typeof note.text !== 'string') {
      return { text: '', exists: false };
    }
    return { text: note.text, exists: true };
  } catch (error) {
    if (isMissingItem(error)) return { text: '', exists: false };
    throw error;
  }
}

/** Saves a note, or removes its database item when the text is empty. */
export async function saveHistoryNote(
  moonraker: MoonrakerProxyHandle,
  jobId: string,
  startTime: number,
  text: string,
  exists: boolean,
): Promise<LoadedHistoryNote> {
  const normalized = text.trim();
  if (!normalized) {
    if (exists) {
      await moonraker.request('server.database.delete_item', {
        namespace: NOTE_NAMESPACE,
        key: noteKey(jobId),
      });
    }
    return { text: '', exists: false };
  }

  const value: StoredHistoryNote = {
    v: 1,
    startTime,
    text: normalized,
    updatedAt: Date.now(),
  };
  await moonraker.request('server.database.post_item', {
    namespace: NOTE_NAMESPACE,
    key: noteKey(jobId),
    value,
  });
  return { text: normalized, exists: true };
}
