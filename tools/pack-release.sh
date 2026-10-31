#!/usr/bin/env bash
# Packs a prebuilt Tessera: what deploy/install.sh downloads and unpacks.
#
# Usage: npm run build && bash tools/pack-release.sh [out-dir]   (default: release/)
# Env:   TESSERA_BUILD_BRANCH  branch name for build-info (default: current git branch)
#
# Writes to out-dir:
#   tessera-<commit>.tar.gz  host/dist, deploy scripts, build-info
#   build-info               the same + ARCHIVE and SHA256, published next to the archive
#
# Same commit → same bytes → same sha256 (sorted entries, zeroed mtime/owner, gzip
# without timestamp), as in tools/registry-pack.cjs. extensions/ is never packed:
# plugins of the printer must survive an update.
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
OUT="$(mkdir -p "${1:-$ROOT/release}" && cd "${1:-$ROOT/release}" && pwd)"

[ -f "$ROOT/host/dist/index.html" ] || { echo "host/dist/index.html not found: run npm run build first" >&2; exit 1; }

COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
SHORT="${COMMIT:0:7}"
BRANCH="${TESSERA_BUILD_BRANCH:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)}"
DATE="$(git -C "$ROOT" log -1 --format=%cd --date=short)"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/host" "$STAGE/deploy"
cp -R "$ROOT/host/dist" "$STAGE/host/dist"
cp "$ROOT/deploy/install.sh" "$ROOT/deploy/install-ext.sh" "$ROOT/deploy/tessera-ext.py" "$STAGE/deploy/"
printf 'COMMIT=%s\nBRANCH=%s\nDATE=%s\n' "$COMMIT" "$BRANCH" "$DATE" > "$STAGE/build-info"
chmod -R a+rX,go-w "$STAGE"

NAME="tessera-$SHORT.tar.gz"
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu \
  -cf - -C "$STAGE" build-info deploy host | gzip -n -9 > "$OUT/$NAME"

SHA256="$(sha256sum "$OUT/$NAME" | cut -d' ' -f1)"
{
  cat "$STAGE/build-info"
  printf 'ARCHIVE=%s\nSHA256=%s\n' "$NAME" "$SHA256"
} > "$OUT/build-info"

echo "$NAME  sha256=$SHA256  ($(wc -c < "$OUT/$NAME") bytes)"
