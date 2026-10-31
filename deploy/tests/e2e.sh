#!/usr/bin/env bash
# End-to-end check of deploy/install.sh on a disposable machine with apt, sudo,
# nginx and systemd (the CI runner): changes the system, do not run on a printer.
#
# Usage: bash deploy/tests/e2e.sh <dir with tessera-*.tar.gz>
set -euo pipefail

RELEASE="${1:?release directory}"
REPO="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)"
ARCHIVE="$(echo "$RELEASE"/tessera-*.tar.gz)"
PORT=8123
DIR="$HOME/tessera-e2e"
UI="http://127.0.0.1:$PORT"
INSTALLER="$REPO/deploy/install.sh"

export TESSERA_NO_PROMPT=1 TESSERA_PORT="$PORT" TESSERA_DIR="$DIR" TESSERA_ARCHIVE="$ARCHIVE"

LOG="$(mktemp)"

step() { printf '\n=== %s\n' "$*" | tee -a "$LOG"; }

# A GitHub annotation: readable without the job log. Newlines must be %0A there.
annotate() { printf '::error::%s\n' "$(printf '%s\n--- last output:\n%s\n--- journal:\n%s' "$1" "$(tail -n 25 "$LOG")" \
  "$(sudo journalctl -u tessera-ext --no-pager -n 10 2>&1 || true)" | sed ':a;N;$!ba;s/%/%25/g;s/\n/%0A/g')"; }
fail() { printf 'FAILED: %s\n' "$*" >&2; annotate "$*"; trap - ERR; exit 1; }
trap 'fail "line $LINENO: $BASH_COMMAND"' ERR

installer() { bash "$INSTALLER" "$@" 2>&1 | tee -a "$LOG"; }

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
expect() { # expect WHAT WANT GOT
  [ "$2" = "$3" ] || fail "$1: expected $2, got $3"
  echo "ok: $1"
}

put_plugin() { # a plugin in extensions/, as if put there by hand
  mkdir -p "$DIR/extensions/hello"
  printf '{ "id": "acme/hello", "name": "Hello", "version": "1.0.0", "entry": "index.js" }\n' > "$DIR/extensions/hello/manifest.json"
  printf 'export const hello = 1;\n' > "$DIR/extensions/hello/index.js"
}

plugin_hash() { (cd "$DIR/extensions/hello" && sha256sum manifest.json index.js); }

# Anything that still reaches for Node.js on the printer leaves a trace here.
SHIMS="$(mktemp -d)"
for c in node npm npx; do
  printf '#!/bin/sh\necho "$0 $*" >> "%s/used"\nexit 1\n' "$SHIMS" > "$SHIMS/$c"
  chmod +x "$SHIMS/$c"
done
export PATH="$SHIMS:$PATH"

step "clean install"
installer install
[ ! -e "$DIR/node_modules" ] && [ ! -e "$DIR/.git" ] || fail "sources in the installation"
[ -f "$DIR/build-info" ] || fail "no build-info"

expect "UI" 200 "$(code "$UI/")"
headers="$(curl -sI "$UI/")"
grep -qi "content-security-policy: script-src 'self'" <<<"$headers" || fail "no CSP on the UI: $headers"
echo "ok: CSP"
expect "policy.json" 200 "$(code "$UI/extensions/policy.json")"
expect "index.json" 200 "$(code "$UI/extensions/index.json")"

step "plugin files are served, an update does not touch them"
put_plugin
tessera_ext="$DIR/deploy/install-ext.sh"
bash "$tessera_ext" sync
index="$(curl -s "$UI/extensions/index.json")"
grep -q '"acme/hello"' <<<"$index" || fail "plugin not in the catalog: $index"
expect "manifest" 200 "$(code "$UI/extensions/hello/manifest.json")"
expect "entry" 200 "$(code "$UI/extensions/hello/index.js")"
before="$(plugin_hash)"
installer reinstall
expect "plugin files after reinstall" "$before" "$(plugin_hash)"
expect "entry after reinstall" 200 "$(code "$UI/extensions/hello/index.js")"

step "service: socket activation, refusals"
systemctl is-active --quiet tessera-ext.socket || fail "socket is not active"
if systemctl is-active --quiet tessera-ext.service; then fail "service runs before anybody asked"; fi
# No Moonraker on this machine: the service starts in its sandbox and refuses.
status="$(code "$UI/tessera-api/v1/status")"
sudo journalctl -u tessera-ext --no-pager -n 10
expect "status without Moonraker" 503 "$status"
expect "unknown API path" 404 "$(code "$UI/tessera-api/v1/nope")"
expect "POST from another site" 403 "$(code -X POST -H 'Origin: http://evil.example' -H 'Content-Type: application/json' -d '{"id":"x"}' "$UI/tessera-api/v1/install")"
expect "POST as a form" 415 "$(code -X POST -H 'Content-Type: text/plain' -d '{"id":"x"}' "$UI/tessera-api/v1/install")"
expect "POST with a URL" 400 "$(code -X POST -H 'Content-Type: application/json' -d '{"id":"x","url":"https://evil.example/a.tar.gz"}' "$UI/tessera-api/v1/install")"

step "service: writes to extensions/ only"
# Runs the sandbox of the real unit: the home directory is hidden, extensions/ is writable.
sudo systemd-run --wait --pipe --quiet \
  --property=User="$(id -un)" --property=ProtectHome=tmpfs --property=ProtectSystem=strict \
  --property=BindPaths="$DIR/extensions" \
  sh -c "touch '$DIR/extensions/.sandbox-check' && rm '$DIR/extensions/.sandbox-check' && ! ls '$REPO' >/dev/null 2>&1" ||
  fail "sandbox does not behave as expected"
echo "ok: sandbox"

step "service off: nginx answers 502, the UI keeps working"
TESSERA_UI_INSTALL=0 installer reinstall
[ ! -e /etc/systemd/system/tessera-ext.socket ] || fail "units are still there"
expect "API with the service off" 502 "$(code "$UI/tessera-api/v1/status")"
expect "UI with the service off" 200 "$(code "$UI/")"

step "remove"
printf 'y\ny\n' | TESSERA_NO_PROMPT=0 installer remove
[ ! -e "$DIR" ] || fail "$DIR is still there"

step "migration of a source checkout"
git clone -q --no-hardlinks "$REPO" "$DIR"
git -C "$DIR" checkout -q v0.5.0-beta
mkdir -p "$DIR/node_modules/x"
put_plugin
before="$(plugin_hash)"
TESSERA_ALLOW_REMOTE_PLUGINS=1 installer update
[ ! -e "$DIR/.git" ] && [ ! -e "$DIR/node_modules" ] && [ ! -e "$DIR/plugins" ] || fail "checkout not removed"
[ -f "$DIR/build-info" ] || fail "no build-info after migration"
expect "plugin files after migration" "$before" "$(plugin_hash)"
expect "UI after migration" 200 "$(code "$UI/")"
expect "plugin entry after migration" 200 "$(code "$UI/extensions/hello/index.js")"
grep -qs '"allowRemotePlugins": true' "$DIR/extensions/policy.json" || fail "plugins-by-URL setting lost"
echo "ok: settings kept"

[ ! -e "$SHIMS/used" ] || fail "Node.js was used: $(cat "$SHIMS/used")"
echo "ok: no Node.js"

printf '\nAll e2e checks passed.\n'
