#!/usr/bin/env bash
# Tessera extensions manager — thin wrapper around tools/tessera-ext.cjs.
#
# Usually run as `tessera-ext` (deploy/install.sh puts that command into
# /usr/local/bin). Without arguments it opens an interactive menu:
#   tessera-ext
#   tessera-ext install spoolman
#   tessera-ext update --all
#   tessera-ext remove spoolman
#   tessera-ext list
# Env:
#   TESSERA_DIR           Tessera installation (default: this checkout, then ~/tessera)
#   TESSERA_REGISTRY_URL  plugin registry (default: idex-eclipse/Tessera-Ext)
set -euo pipefail

die() { printf '\033[1;31m[tessera-ext]\033[0m %s\n' "$*" >&2; exit 1; }

# extensions/ is served by nginx from the user's home and owned by the user:
# files written as root would break later updates run as the user.
[ "$(id -u)" -ne 0 ] || die "Do not run as root: run as the printer user (the one that installed Tessera)."

SELF_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"

DIR="${TESSERA_DIR:-}"
if [ -z "$DIR" ]; then
  if [ -f "$SELF_DIR/../tools/tessera-ext.cjs" ]; then
    DIR="$(cd "$SELF_DIR/.." && pwd)"
  elif [ -f "$HOME/tessera/tools/tessera-ext.cjs" ]; then
    DIR="$HOME/tessera"
  fi
fi
if { [ -z "$DIR" ] || [ ! -f "$DIR/tools/tessera-ext.cjs" ]; } && [ -t 0 ]; then
  read -r -p "Tessera installation directory: " DIR || true
fi
[ -n "$DIR" ] && [ -f "$DIR/tools/tessera-ext.cjs" ] ||
  die "tools/tessera-ext.cjs not found${DIR:+ in $DIR}. Install or update Tessera with deploy/install.sh first."

command -v node >/dev/null 2>&1 || die "node not found. Re-run deploy/install.sh (it installs Node.js)."
NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js >= 18 required (found $(node -v))."

exec node "$DIR/tools/tessera-ext.cjs" "$@"
