#!/usr/bin/env bash
# Tessera extensions manager — thin wrapper around deploy/tessera-ext.py.
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
#   TESSERA_EXT_BRANCH    registry branch for this run (saved choice: tessera-ext branch <name>)
#   TESSERA_REGISTRY_URL  plugin registry.json (default: idex-eclipse/Tessera-Ext, branch main)
set -euo pipefail

die() { printf '\033[1;31m[tessera-ext]\033[0m %s\n' "$*" >&2; exit 1; }

# extensions/ is served by nginx from the user's home and owned by the user:
# files written as root would break later updates run as the user.
[ "$(id -u)" -ne 0 ] || die "Do not run as root: run as the printer user (the one that installed Tessera)."

SELF_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"

DIR="${TESSERA_DIR:-}"
if [ -z "$DIR" ]; then
  if [ -f "$SELF_DIR/tessera-ext.py" ]; then
    DIR="$(cd "$SELF_DIR/.." && pwd)"
  elif [ -f "$HOME/tessera/deploy/tessera-ext.py" ]; then
    DIR="$HOME/tessera"
  fi
fi
if { [ -z "$DIR" ] || [ ! -f "$DIR/deploy/tessera-ext.py" ]; } && [ -t 0 ]; then
  read -r -p "Tessera installation directory: " DIR || true
fi
[ -n "$DIR" ] && [ -f "$DIR/deploy/tessera-ext.py" ] ||
  die "deploy/tessera-ext.py not found${DIR:+ in $DIR}. Install or update Tessera with deploy/install.sh first."

command -v python3 >/dev/null 2>&1 || die "python3 not found. Run: tessera update (it installs python3)."
python3 -c 'import sys; sys.exit(sys.version_info < (3, 7))' ||
  die "Python >= 3.7 required (found $(python3 -V 2>&1))."

exec python3 "$DIR/deploy/tessera-ext.py" "$@"
