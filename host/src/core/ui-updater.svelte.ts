/**
 * Update of Tessera itself from the UI: client of the tessera-update-manager service
 * (deploy/tessera-update-manager.py) behind nginx at /tessera-update/v1/.
 *
 * The service is optional. When it is missing (disabled, dev server, nginx configured by
 * hand) `available` stays false and the UI does not offer the feature: Tessera is then
 * updated with the `tessera` command on the printer. The repository is decided by the
 * service from install.conf; the branch too, unless the user switches it (`update(branch)`).
 * Rights are checked by Moonraker: the service forwards the Authorization of the request.
 */

/** One build as the service reports it; any field may be unknown. */
export interface UiBuild {
  commit: string | null;
  branch: string | null;
  date: string | null;
  version: string | null;
}

export interface UiUpdateStatus {
  installed: UiBuild | null;
  /** The published build of the branch; null when GitHub could not be reached. */
  remote: UiBuild | null;
  branch: string;
  updateAvailable: boolean;
  /** false for a source checkout: `tessera update` has to migrate it. */
  canUpdate: boolean;
  remoteError: string | null;
}

/** Branches that have a published build (`GET branches`). */
export interface UiBranches {
  current: string;
  branches: string[];
  /** Why the list is empty (GitHub unreachable); null otherwise. */
  error: string | null;
}

export interface UiUpdateResult {
  changed: boolean;
  from: string;
  to: string;
}

/** The service answered with an error: status and text come from the server. */
export class UiUpdaterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UiUpdaterError';
  }
}

/** Not our JSON or nobody answered (404/502 from nginx, HTML of a dev server, network). */
class ServiceUnavailableError extends Error {}

export interface UiUpdaterDeps {
  /** Moonraker token of this host (see findHostPrinter). */
  getToken: () => string | null;
  /** For tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

export type UiUpdater = ReturnType<typeof createUiUpdater>;

export function createUiUpdater(deps: UiUpdaterDeps) {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  let available = $state(false);
  let loading = $state(false);
  let status = $state<UiUpdateStatus | null>(null);
  let busy = $state(false);
  let error = $state<UiUpdaterError | null>(null);
  let branches = $state<string[]>([]);
  let branchesLoading = $state(false);
  let branchesError = $state<string | null>(null);

  async function call<T>(path: string, post: boolean, body: Record<string, string> = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (post) headers['Content-Type'] = 'application/json';
    const token = deps.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await doFetch(`/tessera-update/v1/${path}`, {
        method: post ? 'POST' : 'GET',
        headers,
        // The service accepts an empty object or `{ branch }`, nothing else.
        body: post ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new ServiceUnavailableError();
    }

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // Not JSON: handled below.
    }
    if (data === null || typeof data !== 'object') throw new ServiceUnavailableError();
    if (res.ok) return data as T;

    const message = (data as { error?: unknown }).error;
    if (typeof message !== 'string') throw new ServiceUnavailableError();
    throw new UiUpdaterError(message, res.status);
  }

  /**
   * Reads the state of the installation and of the published build.
   * `force` skips the service's cache ("Check for updates"); page opens use the cache.
   */
  async function refresh(force = false): Promise<void> {
    loading = true;
    try {
      status = await call<UiUpdateStatus>(force ? 'status?refresh=1' : 'status', false);
      available = true;
      error = null;
    } catch (e) {
      if (e instanceof UiUpdaterError) {
        // The service exists but refused (e.g. 401): show the reason instead of hiding the block.
        available = true;
        status = null;
        error = e;
      } else {
        available = false;
        status = null;
      }
    } finally {
      loading = false;
    }
  }

  /**
   * Lists the branches that have a published build. Failures end up in `branchesError`
   * (and the list stays empty): the user can still type nothing and keep the current branch.
   */
  async function loadBranches(force = false): Promise<void> {
    branchesLoading = true;
    try {
      const result = await call<UiBranches>(force ? 'branches?refresh=1' : 'branches', false);
      branches = Array.isArray(result.branches) ? result.branches.filter((b) => typeof b === 'string') : [];
      branchesError = result.error ?? null;
    } catch (e) {
      branches = [];
      branchesError = e instanceof Error ? e.message : String(e);
    } finally {
      branchesLoading = false;
    }
  }

  /**
   * true when the new build is in place (the page must be reloaded); the reason is in `error` otherwise.
   * With `branch` the installation is switched to that branch (and the choice is saved on the printer).
   */
  async function update(branch?: string): Promise<boolean> {
    if (busy) return false;
    busy = true;
    error = null;
    try {
      const result = await call<UiUpdateResult>('update', true, branch ? { branch } : {});
      await refresh();
      return result.changed;
    } catch (e) {
      error = e instanceof UiUpdaterError ? e : new UiUpdaterError(e instanceof Error ? e.message : String(e), 0);
      return false;
    } finally {
      busy = false;
    }
  }

  return {
    get available() {
      return available;
    },
    get loading() {
      return loading;
    },
    get status() {
      return status;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    get branches() {
      return branches;
    },
    get branchesLoading() {
      return branchesLoading;
    },
    get branchesError() {
      return branchesError;
    },
    refresh,
    loadBranches,
    update,
  };
}
