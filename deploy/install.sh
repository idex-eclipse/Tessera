#!/usr/bin/env bash
# Tessera installer — Armbian/Debian-first, best-effort universal.
#
# First install (interactive menu):
#   curl -fsSL https://raw.githubusercontent.com/idex-eclipse/tessera/main/deploy/install.sh \
#     -o /tmp/tessera-install.sh && bash /tmp/tessera-install.sh
# Afterwards the menu is the `tessera` command (Install / Update / Remove / Settings / Extensions).
#
# Without the menu:
#   bash install.sh install | update | reinstall | remove | extensions
#   TESSERA_NO_PROMPT=1 TESSERA_PORT=8080 bash install.sh      # install or update, no questions
#   TESSERA_ARCHIVE=tessera.tar.gz bash install.sh install     # from a local archive (tools/pack-release.sh)
#   bash install.sh --plugins-policy                           # old flag: plugins-by-URL setting only
# Settings live in ~/.config/tessera/install.conf; TESSERA_* variables override them.
#
# Nothing is built on the printer: CI publishes a prebuilt archive for each branch
# (.github/workflows/build.yml), this script downloads and verifies it.
set -euo pipefail
shopt -s extglob

# ---------------------------------------------------------------- run from a copy
# `tessera` runs deploy/install.sh from the installation itself. Update replaces
# that file while bash is still reading it, so work from a temp copy.
SELF="$(readlink -f "${BASH_SOURCE[0]}")"
if [ -z "${TESSERA_INSTALLER_COPY:-}" ] && [ "$(basename "$(dirname "$SELF")")" = deploy ]; then
  COPY="$(mktemp /tmp/tessera-install.XXXXXX)"
  cp "$SELF" "$COPY"
  TESSERA_INSTALLER_COPY="$COPY" exec bash "$COPY" "$@"
fi

STAGING=""
cleanup() {
  [ -z "$STAGING" ] || rm -rf "$STAGING"
  # run_action subshells end here too, and the menu still runs from the copy.
  [ "$BASH_SUBSHELL" != 0 ] || [ -z "${TESSERA_INSTALLER_COPY:-}" ] || rm -f "$TESSERA_INSTALLER_COPY"
}
trap cleanup EXIT

# ---------------------------------------------------------------- environment
NO_PROMPT="${TESSERA_NO_PROMPT:-0}"
DRY_RUN="${TESSERA_DRY_RUN:-0}"          # 1 = steps only print what they would do (testing)
SKIP_NGINX="${TESSERA_SKIP_NGINX:-0}"
SKIP_KLIPPER="${TESSERA_SKIP_KLIPPER_CFG:-0}"
ARCHIVE="${TESSERA_ARCHIVE:-}"           # install from this file instead of the published build
FORCE_FETCH=0                            # 1 = download even if the installed commit is current
DEFAULT_REPO_URL="https://github.com/idex-eclipse/tessera.git"

log()  { printf '\033[1;34m[tessera]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[tessera]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[tessera]\033[0m %s\n' "$*" >&2; exit 1; }
dry()  { [ "$DRY_RUN" = 1 ] && { log "[dry-run] $*"; return 0; }; return 1; }

interactive() { [ "$NO_PROMPT" != 1 ]; }

# Prompt that also works with piped input: the prompt is printed by us (read -p
# shows it only on a terminal) and the answer is echoed when not typed.
prompt_line() { # prompt_line VAR "text" — returns 1 on end of input
  local __line
  printf '%s' "$2"
  IFS= read -r __line || { echo; return 1; }
  [ -t 0 ] || printf '%s\n' "$__line"
  printf -v "$1" '%s' "$__line"
}

ask() { # ask VAR "question" default
  if ! interactive; then printf -v "$1" '%s' "$3"; return; fi
  local r=""
  prompt_line r "$2 [$3]: " || r=""
  printf -v "$1" '%s' "${r:-$3}"
}

confirm() { # confirm "question" [default y|n] — 0 = yes
  local def="${2:-n}" r=""
  if ! interactive; then [ "$def" = y ]; return; fi
  if [ "$def" = y ]; then prompt_line r "###### $1 (Y/n): " || r=n
  else prompt_line r "###### $1 (y/N): " || r=n; fi
  case "${r:-$def}" in y|Y|yes|YES) return 0;; *) return 1;; esac
}

pause() { [ -t 0 ] && { read -r -p "Press Enter to continue…" _ || true; }; return 0; }

# ---------------------------------------------------------------- TUI (same look as tessera-ext)
# Box widths count characters, which needs a UTF-8 locale. Without one, the
# boxes fall back to ASCII.
UTF8=0
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) UTF8=1;; esac
if [ "$UTF8" = 0 ]; then
  for l in C.UTF-8 C.utf8 en_US.UTF-8 en_US.utf8; do
    if locale -a 2>/dev/null | grep -qx "$l"; then export LC_ALL="$l"; UTF8=1; break; fi
  done
fi
if [ "$UTF8" = 1 ]; then
  B_TL='╔' B_TR='╗' B_BL='╚' B_BR='╝' B_H='═' B_V='║'
  R_L='╟' R_R='╢' R_H='─' J_T='┬' J_X='┼' J_B='┴' J_V='│' J_L='├'
  ELL='…' BACK='«' ARROW='→'
else
  B_TL='+' B_TR='+' B_BL='+' B_BR='+' B_H='=' B_V='|'
  R_L='+' R_R='+' R_H='-' J_T='+' J_X='+' J_B='+' J_V='|' J_L='+'
  ELL='~' BACK='<<' ARROW='->'
fi
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_G=$'\e[32m' C_R=$'\e[31m' C_Y=$'\e[33m' C_C=$'\e[36m' C_D=$'\e[2m' C_0=$'\e[0m'
else
  C_G='' C_R='' C_Y='' C_C='' C_D='' C_0=''
fi

BOX=55             # inner width; 57 with borders, like kiauh
COL_L=18 COL_R=36  # main menu columns

rep()   { local out='' i; for ((i = 0; i < $2; i++)); do out+="$1"; done; printf '%s' "$out"; }
strip() { printf '%s' "${1//$'\e'\[*([0-9;])m/}"; }
fit() { # fit TEXT WIDTH — pad to WIDTH visible chars; longer text is cut with … and a space
  local s="$1" w="$2" p
  p="$(strip "$s")"
  if [ "${#p}" -gt "$w" ]; then s="${p:0:$((w - 2))}$ELL "; p="$s"; fi
  printf '%s%*s' "$s" $((w - ${#p})) ''
}
box_top()    { printf '%s%s%s\n' "$B_TL" "$(rep "$B_H" $BOX)" "$B_TR"; }
box_bottom() { printf '%s%s%s\n' "$B_BL" "$(rep "$B_H" $BOX)" "$B_BR"; }
rule()       { printf '%s%s%s\n' "$R_L" "$(rep "$R_H" $BOX)" "$R_R"; }
rule2()      { printf '%s%s%s%s%s\n' "$R_L" "$(rep "$R_H" $COL_L)" "$1" "$(rep "$R_H" $COL_R)" "$R_R"; }
row()        { printf '%s%s%s\n' "$B_V" "$(fit "$1" $BOX)" "$B_V"; }
row2()       { printf '%s%s%s%s%s\n' "$B_V" "$(fit "$1" $COL_L)" "$J_V" "$(fit "$2" $COL_R)" "$B_V"; }
row2_sep()   { printf '%s%s%s%s%s\n' "$B_V" "$(fit "$1" $COL_L)" "$J_L" "$(rep "$R_H" $COL_R)" "$R_R"; }
center()     { local p; p="$(strip "$1")"; row "$(rep ' ' $(((BOX - ${#p}) / 2)))$1"; }
title() {
  local mid=" [ $1 ] " rest l
  rest=$((BOX - 2 - ${#mid})); l=$((rest / 2))
  row " $(rep '~' $l) [ ${C_C}$1${C_0} ] $(rep '~' $((rest - l))) "
}
header() {
  box_top
  title 'TESSERA'
  center 'Tessera Installation And Update Helper'
  row " $(rep '~' $((BOX - 2))) "
  box_bottom
}

# ---------------------------------------------------------------- privileges/home
[ "$(id -u)" -ne 0 ] || die "Do not run this script directly as root. Run it as a regular user with sudo privileges."
if [ "$DRY_RUN" = 1 ]; then SUDO="echo [dry-run] sudo"; else
  command -v sudo >/dev/null || die "sudo is required but not found"
  SUDO="sudo"
fi

REAL_USER="$(id -un)"
REAL_HOME="$(getent passwd "$REAL_USER" 2>/dev/null | cut -d: -f6 || true)"; [ -n "$REAL_HOME" ] || REAL_HOME="$HOME"
CONF_FILE="${XDG_CONFIG_HOME:-$REAL_HOME/.config}/tessera/install.conf"
CMD_MENU=/usr/local/bin/tessera
CMD_EXT=/usr/local/bin/tessera-ext
UNIT_SOCKET=/etc/systemd/system/tessera-ext.socket
UNIT_SERVICE=/etc/systemd/system/tessera-ext.service
# Separate service for "Update Tessera" in the UI: it may write the installation directory.
UNIT_UPD_SOCKET=/etc/systemd/system/tessera-update-manager.socket
UNIT_UPD_SERVICE=/etc/systemd/system/tessera-update-manager.service

as_user() { # as_user "cmd" — always run as the printer owner
  # Since running as root is forbidden, we are always the target user
  bash -c "$1"
}

nginx_paths() {
  NGINX_AV=/etc/nginx/sites-available; NGINX_EN=/etc/nginx/sites-enabled
  [ -d /etc/nginx/sites-enabled ] || { NGINX_AV=/etc/nginx/conf.d; NGINX_EN=""; }
}

# ---------------------------------------------------------------- settings
# Precedence: TESSERA_* env (first load only) > install.conf > existing installation > default.
CONF_KEYS="INSTALL_DIR BRANCH REPO_URL PORT MOONRAKER KLIPPER_CFG_DIR KLIPPER_DIR ALLOW_REMOTE UI_INSTALL UI_UPDATE"
USE_ENV=1

load_settings() {
  local -A conf=()
  local line k v
  if [ -f "$CONF_FILE" ]; then
    # Parsed line by line (not `source`d): the file is data, never code.
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in ''|\#*) continue;; esac
      k="${line%%=*}"; v="${line#*=}"
      case " $CONF_KEYS " in *" $k "*) conf[$k]="$v";; esac
    done < "$CONF_FILE"
  fi
  # e_* — environment (first load only); p_* — values of the previous load, so a
  # reload after an action without install.conf does not fall back to defaults.
  local e_dir='' e_branch='' e_port='' e_moon='' e_cfg='' e_kdir='' e_remote='' e_repo='' e_ui='' e_upd=''
  local p_dir='' p_branch='' p_port='' p_moon='' p_cfg='' p_kdir='' p_remote='' p_repo='' p_ui='' p_upd=''
  if [ "$USE_ENV" = 1 ]; then
    e_dir="${TESSERA_DIR:-}" e_branch="${TESSERA_BRANCH:-}" e_port="${TESSERA_PORT:-}"
    e_moon="${TESSERA_MOONRAKER:-}" e_cfg="${TESSERA_KLIPPER_CFG:-}" e_kdir="${TESSERA_KLIPPER_DIR:-}"
    e_remote="${TESSERA_ALLOW_REMOTE_PLUGINS:-}" e_repo="${TESSERA_REPO:-}" e_ui="${TESSERA_UI_INSTALL:-}"
    e_upd="${TESSERA_UI_UPDATE:-}"
  else
    p_dir="$INSTALL_DIR" p_branch="$BRANCH" p_port="$PORT" p_moon="$MOONRAKER"
    p_cfg="$KLIPPER_CFG_DIR" p_kdir="$KLIPPER_DIR" p_remote="$ALLOW_REMOTE" p_repo="$REPO_URL" p_ui="$UI_INSTALL"
    p_upd="$UI_UPDATE"
  fi
  INSTALL_DIR="${e_dir:-${conf[INSTALL_DIR]:-${p_dir:-$REAL_HOME/tessera}}}"
  # install.conf describes one installation: ignore it for another directory.
  if [ -n "${conf[INSTALL_DIR]:-}" ] && [ "${conf[INSTALL_DIR]}" != "$INSTALL_DIR" ]; then conf=(); fi

  # Detected from an existing installation (made before install.conf existed).
  local d_branch='' d_port='' d_moon='' d_remote='' d_repo=''
  if [ -d "$INSTALL_DIR/.git" ]; then
    d_branch="$(git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    [ "$d_branch" = HEAD ] && d_branch=''
    d_repo="$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || true)"
  fi
  [ -n "$d_branch" ] || d_branch="$(build_info_get "$INSTALL_DIR/build-info" BRANCH)"
  nginx_paths
  if [ -f "$NGINX_AV/tessera" ]; then
    d_port="$(grep -oE 'listen +[0-9]+;' "$NGINX_AV/tessera" 2>/dev/null | head -1 | grep -oE '[0-9]+' || true)"
    d_moon="$(grep -oE 'proxy_pass http://[^/$;]+/websocket' "$NGINX_AV/tessera" 2>/dev/null | head -1 | sed 's|proxy_pass http://||; s|/websocket||' || true)"
  fi
  if [ -f "$INSTALL_DIR/extensions/policy.json" ]; then
    d_remote=0
    grep -qs '"allowRemotePlugins": *true' "$INSTALL_DIR/extensions/policy.json" && d_remote=1
  fi

  BRANCH="${e_branch:-${conf[BRANCH]:-${p_branch:-${d_branch:-main}}}}"
  PORT="${e_port:-${conf[PORT]:-${p_port:-${d_port:-8000}}}}"
  MOONRAKER="${e_moon:-${conf[MOONRAKER]:-${p_moon:-${d_moon:-127.0.0.1:7125}}}}"
  KLIPPER_CFG_DIR="${e_cfg:-${conf[KLIPPER_CFG_DIR]:-${p_cfg:-$REAL_HOME/printer_data/config}}}"
  KLIPPER_DIR="${e_kdir:-${conf[KLIPPER_DIR]:-${p_kdir:-$REAL_HOME/klipper}}}"
  ALLOW_REMOTE="${e_remote:-${conf[ALLOW_REMOTE]:-${p_remote:-${d_remote:-0}}}}"
  REPO_URL="${e_repo:-${conf[REPO_URL]:-${p_repo:-${d_repo:-$DEFAULT_REPO_URL}}}}"
  UI_INSTALL="${e_ui:-${conf[UI_INSTALL]:-${p_ui:-1}}}"
  UI_UPDATE="${e_upd:-${conf[UI_UPDATE]:-${p_upd:-1}}}"
  USE_ENV=0
}

save_conf() {
  mkdir -p "$(dirname "$CONF_FILE")"
  {
    echo "# Tessera installer settings — written by deploy/install.sh"
    local k
    for k in $CONF_KEYS; do printf '%s=%s\n' "$k" "${!k}"; done
  } > "$CONF_FILE"
}

# .git = installation made before prebuilt builds; step_fetch migrates it.
is_installed() { [ -f "$INSTALL_DIR/build-info" ] || [ -d "$INSTALL_DIR/.git" ]; }

# build-info: KEY=value lines written by tools/pack-release.sh; data, never code.
build_info_get() { # build_info_get FILE KEY
  sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1 || true
}

# Short commit of what is installed.
installed_commit() {
  if [ -f "$INSTALL_DIR/build-info" ]; then
    build_info_get "$INSTALL_DIR/build-info" COMMIT | cut -c1-7
  else
    git -C "$INSTALL_DIR" rev-parse --short=7 HEAD 2>/dev/null || echo '?'
  fi
}

count_extensions() {
  local n=0 d
  for d in "$INSTALL_DIR"/extensions/*/; do [ -f "$d/manifest.json" ] && n=$((n + 1)); done
  echo "$n"
}

# ---------------------------------------------------------------- plugins by URL policy
# CSP on the UI document: browser refuses scripts from other origins,
# so only same-origin /extensions/ plugins can be loaded. The comment marks
# the spot so the setting can be toggled in an existing nginx config.
CSP_ON="add_header Content-Security-Policy \"script-src 'self'\" always;"
CSP_OFF="# tessera: plugins by URL allowed, no CSP"

# policy.json only tells the UI whether to offer "Add by URL"; enforcement is the nginx CSP.
write_policy() {
  local v=false; [ "$ALLOW_REMOTE" = 1 ] && v=true
  dry "write $INSTALL_DIR/extensions/policy.json (allowRemotePlugins: $v)" && return 0
  mkdir -p "$INSTALL_DIR/extensions"
  printf '{ "allowRemotePlugins": %s }\n' "$v" > "$INSTALL_DIR/extensions/policy.json"
}

remote_summary() {
  if [ "$ALLOW_REMOTE" = 1 ]; then echo "allowed (no CSP)"; else echo "blocked by CSP"; fi
}

# Applies ALLOW_REMOTE to an installed Tessera without a download.
apply_plugins_policy() {
  is_installed || { log "plugins by URL: $(remote_summary) — applied on install"; return 0; }
  write_policy
  nginx_paths
  local conf="$NGINX_AV/tessera" from to
  dry "toggle CSP in $conf, nginx -t, reload nginx" && return 0
  if [ -f "$conf" ] && $SUDO grep -qF -e "$CSP_ON" -e "$CSP_OFF" "$conf"; then
    if [ "$ALLOW_REMOTE" = 1 ]; then from="$CSP_ON"; to="$CSP_OFF"; else from="$CSP_OFF"; to="$CSP_ON"; fi
    $SUDO sed -i "s|$from|$to|g" "$conf"
    $SUDO nginx -t || die "nginx -t failed — edit $conf manually"
    $SUDO systemctl reload-or-restart nginx
  else
    warn "no Tessera CSP marker in $conf — run Update to rewrite the nginx config"
  fi
  log "plugins by URL: $(remote_summary). Reload the UI page."
}

# ---------------------------------------------------------------- install steps
step_deps() {
  dry "check packages curl/tar/nginx/python3" && return 0
  if command -v apt-get >/dev/null 2>&1; then
    log "checking system packages (curl/tar/nginx/python3)"
    local miss="" p
    for p in curl tar nginx python3; do command -v "$p" >/dev/null 2>&1 || miss="$miss $p"; done
    # https from curl and python3 needs it, and it has no command to look for.
    [ -f /etc/ssl/certs/ca-certificates.crt ] || miss="$miss ca-certificates"
    if [ -n "$miss" ]; then
      $SUDO apt-get update -qq || true
      # shellcheck disable=SC2086
      $SUDO apt-get install -y $miss
    fi
  else
    warn "non-Debian family: auto package install skipped."
    warn "ensure manually: curl, tar, nginx, python3 >= 3.7, then re-run this script."
  fi

  local c
  for c in curl tar gzip sha256sum; do
    command -v "$c" >/dev/null 2>&1 || die "$c not found: install it and re-run"
  done
  if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 7))' 2>/dev/null; then
    warn "python3 >= 3.7 not found: tessera-ext and installing plugins from the UI will not work."
  fi
}

https_get() { curl -fsSL --proto '=https' --proto-redir '=https' "$@"; }

# owner/repo of REPO_URL; the builds are GitHub releases of that repository.
repo_slug() {
  local slug="${REPO_URL%/}"
  slug="${slug%.git}"
  case "$slug" in
    https://github.com/*)     slug="${slug#https://github.com/}";;
    git@github.com:*)         slug="${slug#git@github.com:}";;
    ssh://git@github.com/*)   slug="${slug#ssh://git@github.com/}";;
    *) return 1;;
  esac
  [[ "$slug" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || return 1
  printf '%s' "$slug"
}

# URL of the rolling release of BRANCH (.github/workflows/build.yml).
release_base() {
  local slug
  slug="$(repo_slug)" || return 1
  printf 'https://github.com/%s/releases/download/build-%s' "$slug" "${BRANCH//\//-}"
}

remote_commit() { # short commit of the published build, empty when unreachable
  local base
  base="$(release_base)" || return 0
  https_get -m 10 "$base/build-info" 2>/dev/null | sed -n 's/^COMMIT=//p' | cut -c1-7 || true
}

# Rejects absolute paths, `..` and anything that is not a plain file or directory.
check_archive() { # check_archive FILE
  local line name
  tar -tzf "$1" > /dev/null || die "archive is damaged: $1"
  while IFS= read -r line; do
    case "$line" in
      -*|d*) ;;
      *) die "archive contains an unsupported entry: $line";;
    esac
  done < <(tar -tvzf "$1")
  while IFS= read -r name; do
    case "/$name/" in
      //*|*/../*|*\\*) die "archive contains an unsafe path: $name";;
    esac
  done < <(tar -tzf "$1")
}

SWAP_ITEMS="host deploy build-info"

# .old/ holds the previous build until the swap commits: renaming it to .trash
# is the single point after which there is no going back.
recover_swap() {
  rm -rf "$INSTALL_DIR/.trash"
  [ -d "$INSTALL_DIR/.old" ] || return 0
  warn "restoring the previous build (an update did not finish)"
  local item
  for item in $SWAP_ITEMS; do
    [ -e "$INSTALL_DIR/.old/$item" ] || continue
    rm -rf "${INSTALL_DIR:?}/$item"
    mv "$INSTALL_DIR/.old/$item" "$INSTALL_DIR/$item"
  done
  rm -rf "$INSTALL_DIR/.old"
}

swap_in() { # swap_in TREE
  local item
  mkdir "$INSTALL_DIR/.old"
  for item in $SWAP_ITEMS; do
    if [ -e "$INSTALL_DIR/$item" ]; then
      mv "$INSTALL_DIR/$item" "$INSTALL_DIR/.old/$item" || { recover_swap; die "cannot replace $item"; }
    fi
    mv "$1/$item" "$INSTALL_DIR/$item" || { recover_swap; die "cannot replace $item"; }
  done
  mv "$INSTALL_DIR/.old" "$INSTALL_DIR/.trash"
  rm -rf "$INSTALL_DIR/.trash"
}

# Everything of a source checkout except what swap_in just put there and extensions/.
remove_checkout() {
  find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 \
    ! -name extensions ! -name host ! -name deploy ! -name build-info \
    ! -path "$STAGING" -exec rm -rf {} +
}

step_fetch() {
  BUILD_DIR="$INSTALL_DIR/host/dist"
  dry "download the $BRANCH build of $REPO_URL, verify sha256, unpack into $INSTALL_DIR (extensions/ is kept)" && return 0

  local legacy=0
  if [ -d "$INSTALL_DIR/.git" ]; then
    legacy=1
    case "$INSTALL_DIR" in /|"$REAL_HOME"|"$REAL_HOME/") die "refusing to replace $INSTALL_DIR";; esac
    [ -f "$INSTALL_DIR/deploy/install.sh" ] || die "$INSTALL_DIR does not look like Tessera — refusing to replace it"
  elif ! is_installed && [ -d "$INSTALL_DIR" ] &&
       [ -n "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 ! -name extensions ! -name '.staging-*' -print -quit)" ]; then
    die "$INSTALL_DIR is not empty and is not a Tessera installation"
  fi

  mkdir -p "$INSTALL_DIR"
  recover_swap
  rm -rf "$INSTALL_DIR"/.staging-*
  STAGING="$(mktemp -d "$INSTALL_DIR/.staging-XXXXXX")"
  trap cleanup EXIT   # traps do not reach the subshell of run_action

  local file="$STAGING/build.tar.gz"
  if [ -n "$ARCHIVE" ]; then
    [ -f "$ARCHIVE" ] || die "TESSERA_ARCHIVE: $ARCHIVE not found"
    log "installing from $ARCHIVE"
    cp "$ARCHIVE" "$file"
  else
    local base info commit name sha
    base="$(release_base)" || die "$REPO_URL is not a GitHub repository: use TESSERA_ARCHIVE=<file>"
    info="$STAGING/build-info.remote"
    https_get -m 30 "$base/build-info" -o "$info" ||
      die "no published build of branch $BRANCH at $base (CI may still be running, try again in a few minutes)"
    commit="$(build_info_get "$info" COMMIT)"
    name="$(build_info_get "$info" ARCHIVE)"
    sha="$(build_info_get "$info" SHA256)"
    [[ "$commit" =~ ^[0-9a-f]{7,40}$ && "$name" =~ ^tessera-[0-9a-f]+\.tar\.gz$ && "$sha" =~ ^[0-9a-f]{64}$ ]] ||
      die "invalid build-info at $base"

    if [ "$legacy" = 0 ] && [ "$FORCE_FETCH" != 1 ] && [ "$commit" = "$(build_info_get "$INSTALL_DIR/build-info" COMMIT)" ]; then
      log "already on the latest $BRANCH build (${commit:0:7})"
      rm -rf "$STAGING"; STAGING=""
      return 0
    fi

    log "downloading the $BRANCH build (${commit:0:7})"
    https_get -m 300 "$base/$name" -o "$file" || die "download failed: $base/$name"
    printf '%s  %s\n' "$sha" "$file" | sha256sum -c --status - || die "sha256 mismatch: $base/$name"
  fi

  check_archive "$file"
  local tree="$STAGING/tree"
  mkdir "$tree"
  # --touch: the archive has zero mtimes for reproducibility, and nginx builds ETag from mtime.
  tar -xzf "$file" -C "$tree" --no-same-owner --no-same-permissions --touch
  local must
  for must in host/dist/index.html deploy/install.sh deploy/install-ext.sh deploy/tessera-ext.py deploy/tessera-update-manager.py build-info; do
    [ -f "$tree/$must" ] || die "archive has no $must"
  done
  chmod -R a+rX "$tree"

  if [ "$legacy" = 1 ]; then
    warn "$INSTALL_DIR is a source checkout. It will be replaced with the prebuilt UI:"
    warn "sources, .git and node_modules are deleted, extensions/ and your settings stay."
    confirm "Replace it?" y || { log "cancelled, nothing changed"; exit 0; }
  fi

  swap_in "$tree"
  [ "$legacy" = 0 ] || remove_checkout
  rm -rf "$STAGING"; STAGING=""

  chmod a+rx "$INSTALL_DIR" 2>/dev/null || true
  case "$INSTALL_DIR" in
    "$REAL_HOME"/*) chmod a+x "$REAL_HOME" 2>/dev/null || true
                    warn "home directory made traversable (nginx reads dist from home)";;
  esac
}

# Writes /usr/local/bin/<name> that runs a script of this installation.
install_command() { # install_command PATH SCRIPT
  dry "create $1 → $2" && return 0
  {
    printf '#!/usr/bin/env bash\n'
    printf '# Installed by Tessera deploy/install.sh for %s\n' "$INSTALL_DIR"
    printf 'export TESSERA_DIR="${TESSERA_DIR:-%s}"\n' "$INSTALL_DIR"
    printf 'exec bash %q "$@"\n' "$2"
  } > /tmp/tessera-cmd
  if $SUDO install -m 755 /tmp/tessera-cmd "$1"; then
    log "command: $(basename "$1")"
  else
    warn "could not create $1 — use: bash $2"
  fi
  rm -f /tmp/tessera-cmd
}

step_extensions() {
  write_policy
  if ! dry "python3 deploy/tessera-ext.py sync"; then
    as_user "python3 '$INSTALL_DIR/deploy/tessera-ext.py' sync" || warn "extensions index not generated"
  fi
  # `tessera` = this menu, `tessera-ext` = plugin manager (deploy/install-ext.sh).
  install_command "$CMD_MENU" "$INSTALL_DIR/deploy/install.sh"
  install_command "$CMD_EXT" "$INSTALL_DIR/deploy/install-ext.sh"
}

# ---------------------------------------------------------------- service for "install from the UI"
# deploy/tessera-ext.py serve, socket-activated: no process while nobody uses it.
# nginx always has the /tessera-api/ location; with no service it answers 502
# and the UI simply does not offer the feature.
ui_install_summary() {
  if [ "$UI_INSTALL" = 1 ]; then echo "enabled"; else echo "disabled"; fi
}

nginx_group() { # primary group of the nginx worker user: only nginx may connect to the socket
  local user
  user="$(sed -n 's/^[[:space:]]*user[[:space:]]\{1,\}\([^[:space:];]*\).*/\1/p' /etc/nginx/nginx.conf 2>/dev/null | head -n 1 || true)"
  id -gn "${user:-www-data}" 2>/dev/null
}

disable_service() {
  dry "disable and remove tessera-ext.socket, tessera-ext.service" && return 0
  [ -f "$UNIT_SOCKET" ] || [ -f "$UNIT_SERVICE" ] || return 0
  $SUDO systemctl disable --now tessera-ext.socket 2>/dev/null || true
  $SUDO systemctl stop tessera-ext.service 2>/dev/null || true
  $SUDO rm -f "$UNIT_SOCKET" "$UNIT_SERVICE"
  $SUDO systemctl daemon-reload 2>/dev/null || true
}

step_service() {
  if [ "$UI_INSTALL" != 1 ]; then disable_service; return 0; fi
  dry "write and enable tessera-ext.socket, tessera-ext.service" && return 0

  local python group cfg_dir
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "no systemd: plugins can be installed with tessera-ext only, not from the UI"; return 0
  fi
  python="$(command -v python3 || true)"
  if [ -z "$python" ] || ! "$python" -c 'import sys; sys.exit(sys.version_info < (3, 7))' 2>/dev/null; then
    warn "no python3 >= 3.7: plugins cannot be installed from the UI"; return 0
  fi
  case "$INSTALL_DIR" in
    *[[:space:]]*) warn "spaces in $INSTALL_DIR: plugins cannot be installed from the UI"; return 0;;
  esac
  group="$(nginx_group)" || { warn "cannot find the nginx user: plugins cannot be installed from the UI"; return 0; }
  cfg_dir="$(dirname "$CONF_FILE")"
  mkdir -p "$cfg_dir" "$INSTALL_DIR/extensions" "$cfg_dir/services"
  # Addresses and secrets of plugin services (api.services): owner only.
  chmod 700 "$cfg_dir/services"

  cat > /tmp/tessera-ext.socket <<SOCKET
[Unit]
Description=Tessera extensions API socket

[Socket]
ListenStream=/run/tessera-ext.sock
SocketGroup=$group
SocketMode=0660

[Install]
WantedBy=sockets.target
SOCKET

  cat > /tmp/tessera-ext.service <<SERVICE
[Unit]
Description=Tessera extensions API (install plugins from the UI)
Requires=tessera-ext.socket

[Service]
Type=simple
User=$REAL_USER
ExecStart=$python $INSTALL_DIR/deploy/tessera-ext.py serve
Environment=TESSERA_MOONRAKER=$MOONRAKER
Environment=XDG_CONFIG_HOME=$(dirname "$cfg_dir")
UMask=0022
# It may write only extensions/ and the secrets of plugin services. services/ lies inside
# the read-only config folder: systemd mounts the deeper path last, so it stays writable.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=tmpfs
BindPaths=$INSTALL_DIR/extensions $cfg_dir/services
BindReadOnlyPaths=$INSTALL_DIR/deploy $cfg_dir
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=128M
SERVICE

  $SUDO install -m 644 /tmp/tessera-ext.socket "$UNIT_SOCKET"
  $SUDO install -m 644 /tmp/tessera-ext.service "$UNIT_SERVICE"
  rm -f /tmp/tessera-ext.socket /tmp/tessera-ext.service
  if $SUDO systemctl daemon-reload &&
     $SUDO systemctl enable tessera-ext.socket >/dev/null 2>&1 &&
     $SUDO systemctl restart tessera-ext.socket; then
    # A running service still has the previous deploy/ mounted.
    $SUDO systemctl try-restart tessera-ext.service || true
    log "plugins from the UI: enabled"
  else
    warn "cannot start tessera-ext.socket: plugins can be installed with tessera-ext only"
  fi
}

ui_update_summary() {
  if [ "$UI_UPDATE" = 1 ]; then echo "enabled"; else echo "disabled"; fi
}

disable_update_service() {
  dry "disable and remove tessera-update-manager.socket, tessera-update-manager.service" && return 0
  [ -f "$UNIT_UPD_SOCKET" ] || [ -f "$UNIT_UPD_SERVICE" ] || return 0
  $SUDO systemctl disable --now tessera-update-manager.socket 2>/dev/null || true
  $SUDO systemctl stop tessera-update-manager.service 2>/dev/null || true
  $SUDO rm -f "$UNIT_UPD_SOCKET" "$UNIT_UPD_SERVICE"
  $SUDO systemctl daemon-reload 2>/dev/null || true
}

# "Update Tessera" button in Settings → About. A service of its own, not part of tessera-ext:
# replacing the UI needs write access to the installation directory, and tessera-ext may
# write extensions/ only. It never runs sudo: nginx and unit changes stay with `tessera update`.
step_update_service() {
  if [ "$UI_UPDATE" != 1 ]; then disable_update_service; return 0; fi
  dry "write and enable tessera-update-manager.socket, tessera-update-manager.service" && return 0

  local python group cfg_dir
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "no systemd: Tessera can be updated with the tessera command only, not from the UI"; return 0
  fi
  python="$(command -v python3 || true)"
  if [ -z "$python" ] || ! "$python" -c 'import sys; sys.exit(sys.version_info < (3, 7))' 2>/dev/null; then
    warn "no python3 >= 3.7: Tessera cannot be updated from the UI"; return 0
  fi
  case "$INSTALL_DIR" in
    *[[:space:]]*) warn "spaces in $INSTALL_DIR: Tessera cannot be updated from the UI"; return 0;;
  esac
  group="$(nginx_group)" || { warn "cannot find the nginx user: Tessera cannot be updated from the UI"; return 0; }
  cfg_dir="$(dirname "$CONF_FILE")"
  mkdir -p "$cfg_dir"

  cat > /tmp/tessera-update-manager.socket <<SOCKET
[Unit]
Description=Tessera update manager API socket

[Socket]
ListenStream=/run/tessera-update-manager.sock
SocketGroup=$group
SocketMode=0660

[Install]
WantedBy=sockets.target
SOCKET

  cat > /tmp/tessera-update-manager.service <<SERVICE
[Unit]
Description=Tessera update manager (update the UI from its settings)
Requires=tessera-update-manager.socket

[Service]
Type=simple
User=$REAL_USER
ExecStart=$python $INSTALL_DIR/deploy/tessera-update-manager.py serve
Environment=TESSERA_MOONRAKER=$MOONRAKER
Environment=TESSERA_DIR=$INSTALL_DIR
Environment=XDG_CONFIG_HOME=$(dirname "$cfg_dir")
UMask=0022
# Writes the installation directory (host/, deploy/, build-info) and the settings folder
# (only BRANCH of install.conf, when the branch is switched from the UI), nothing else.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=tmpfs
BindPaths=$INSTALL_DIR $cfg_dir
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=128M
SERVICE

  $SUDO install -m 644 /tmp/tessera-update-manager.socket "$UNIT_UPD_SOCKET"
  $SUDO install -m 644 /tmp/tessera-update-manager.service "$UNIT_UPD_SERVICE"
  rm -f /tmp/tessera-update-manager.socket /tmp/tessera-update-manager.service
  if $SUDO systemctl daemon-reload &&
     $SUDO systemctl enable tessera-update-manager.socket >/dev/null 2>&1 &&
     $SUDO systemctl restart tessera-update-manager.socket; then
    # A running service still has the previous build mounted.
    $SUDO systemctl try-restart tessera-update-manager.service || true
    log "update from the UI: enabled"
  else
    warn "cannot start tessera-update-manager.socket: Tessera can be updated with the tessera command only"
  fi
}

step_nginx() {
  if [ "$SKIP_NGINX" = 1 ]; then
    warn "SKIP_NGINX=1: configure dist serving and proxy yourself (root=$BUILD_DIR)"
    return 0
  fi
  nginx_paths
  dry "nginx site $NGINX_AV/tessera (port $PORT → $BUILD_DIR, Moonraker $MOONRAKER, CSP: $(remote_summary)), nginx -t, reload" && return 0

  # A port held by our own site (update) is not a conflict.
  if ! grep -qsE "listen +$PORT;" "$NGINX_AV/tessera" &&
     command -v ss >/dev/null 2>&1 && ss -ltn | awk '{print $4}' | grep -qE "[:.]${PORT}$"; then
    warn "port $PORT is already in use"
    if ! confirm "Continue anyway (conflict will show in nginx -t)?"; then
      ask PORT "New port" "8081"
      save_conf
    fi
  fi

  # map for websocket upgrade: create only if not already in nginx config
  if ! $SUDO grep -rq 'map \$http_upgrade' /etc/nginx 2>/dev/null; then
    cat > /tmp/tessera-upgrade-map.conf <<'MAP'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
MAP
    $SUDO install -m 644 /tmp/tessera-upgrade-map.conf /etc/nginx/conf.d/tessera-upgrade-map.conf
  fi

  cat > /tmp/tessera-nginx.conf <<'NGINX'
server {
    listen @PORT@;
    listen [::]:@PORT@;
    server_name _;

    access_log /var/log/nginx/tessera-access.log;
    error_log  /var/log/nginx/tessera-error.log;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 4;
    gzip_buffers 16 8k;
    gzip_http_version 1.1;
    gzip_types text/plain text/css text/xml text/javascript application/javascript
               application/x-javascript application/json application/xml image/svg+xml;

    root @BUILD_DIR@;
    index index.html;

    client_max_body_size 0;          # gcode uploads without limits
    proxy_request_buffering off;

    # extension provisioning: directory and remote plugins always fresh
    location /extensions/ {
        alias @INSTALL_DIR@/extensions/;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # tessera-ext service: install plugins from the UI and the proxy to plugin services
    # (/tessera-api/v1/services/). It authorizes requests with Moonraker using the headers
    # set here; no service → 502, the UI does not offer it. proxy_pass has no URI part on
    # purpose: the request URI reaches the service as sent, %2F in plugin ids included.
    # 1m: the largest body the service proxy forwards (MAX_PROXY_BODY).
    location /tessera-api/ {
        proxy_pass http://unix:/run/tessera-ext.sock;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 180s;
        proxy_request_buffering on;
        client_max_body_size 1m;
    }

    # tessera-update-manager service: "Update Tessera" in Settings → About. Same Moonraker
    # authorization as above; no service → 502, the UI does not offer the button.
    location /tessera-update/ {
        proxy_pass http://unix:/run/tessera-update-manager.sock;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;         # downloading and unpacking a build
        proxy_request_buffering on;
        client_max_body_size 16k;
    }

    location = /index.html {
        @CSP@
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    location / {
        try_files $uri $uri/ /index.html;
        @CSP@
    }

    location /websocket {
        proxy_pass http://@MOONRAKER@/websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    # Raw Klippy bridge: bulk streams (load_cell/dump_force) for the graph of plugins.
    location /klippysocket {
        proxy_pass http://@MOONRAKER@/klippysocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    location ~ ^/(printer|api|access|machine|server)/ {
        proxy_pass http://@MOONRAKER@$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Scheme $scheme;
    }

    # Cameras: uncomment for your crowsnest/mjpegstreamer setup.
    # location /webcam/  { postpone_output 0; proxy_buffering off;
    #                      proxy_ignore_headers X-Accel-Buffering;
    #                      proxy_pass http://127.0.0.1:8080/; }
}
NGINX
  local csp_line="$CSP_ON"; [ "$ALLOW_REMOTE" = 1 ] && csp_line="$CSP_OFF"
  sed -i "s|@PORT@|$PORT|g; s|@MOONRAKER@|$MOONRAKER|g; s|@BUILD_DIR@|$BUILD_DIR|g; s|@INSTALL_DIR@|$INSTALL_DIR|g; s|@CSP@|$csp_line|g" \
    /tmp/tessera-nginx.conf

  $SUDO install -m 644 /tmp/tessera-nginx.conf "$NGINX_AV/tessera"
  [ -n "$NGINX_EN" ] && $SUDO ln -sf "$NGINX_AV/tessera" "$NGINX_EN/tessera"
  $SUDO nginx -t || die "nginx -t failed — edit $NGINX_AV/tessera manually"
  # nginx may be installed but stopped: then a plain reload fails.
  $SUDO systemctl reload-or-restart nginx
  log "nginx: http://<host-ip>:$PORT/"
}

KLIPPER_INCLUDE='[include tessera-shell.cfg]'
KLIPPER_COMMENT='# Tessera shell graphs (extension found)'

step_klipper() {
  if [ "$SKIP_KLIPPER" = 1 ] || [ ! -d "$KLIPPER_CFG_DIR" ]; then
    warn "Klipper config skipped (SKIP_KLIPPER=1 or no $KLIPPER_CFG_DIR)"
    return 0
  fi
  dry "write $KLIPPER_CFG_DIR/tessera-shell.cfg, include it in printer.cfg if gcode_shell_command exists" && return 0
  mkdir -p "$KLIPPER_CFG_DIR/shapers"

  cat > /tmp/tessera-shell.cfg <<'CFG'
# Tessera — shaper/belt graphs via gcode_shell_command.
# REQUIRES Klipper extension "gcode_shell_command" (install manually via kiauh!).
# UI sends RUN_SHELL_COMMAND CMD=tessera_graph_x|tessera_graph_y|tessera_graph_belts
# after TEST_RESONANCES … OUTPUT=raw_data; csv is cleaned AFTER graph generation.
# NOTE: gcode_shell_command does shlex.split() + Popen() WITHOUT a shell, so "&&",
# globs (/tmp/*.csv) and $(date) are NOT interpreted by itself. Every command must
# be one quoted "bash -c" argument, otherwise "&&" and the rest are passed to the
# first program as plain arguments (e.g. "mkdir: invalid option -- 'c'").
[gcode_shell_command generate_x_shaper_graph]
command: bash -c "mkdir -p @CFG_DIR@/shapers && @KLIPPER_DIR@/scripts/calibrate_shaper.py /tmp/*_x*.csv -o @CFG_DIR@/shapers/x_$(date +%Y%m%d-%H%M%S).png && rm -f /tmp/*_x*.csv"
timeout: 180
verbose: True

[gcode_shell_command generate_y_shaper_graph]
command: bash -c "mkdir -p @CFG_DIR@/shapers && @KLIPPER_DIR@/scripts/calibrate_shaper.py /tmp/*_y*.csv -o @CFG_DIR@/shapers/y_$(date +%Y%m%d-%H%M%S).png && rm -f /tmp/*_y*.csv"
timeout: 180
verbose: True

[gcode_shell_command generate_belts_graph]
command: bash -c "mkdir -p @CFG_DIR@/shapers && python3 @KLIPPER_DIR@/scripts/graph_accelerometer.py /tmp/*_data*.csv -o @CFG_DIR@/shapers/belts_$(date +%Y%m%d-%H%M%S).png && rm -f /tmp/*_data*.csv"
timeout: 180
verbose: True
CFG
  sed -i "s|@CFG_DIR@|$KLIPPER_CFG_DIR|g; s|@KLIPPER_DIR@|$KLIPPER_DIR|g" /tmp/tessera-shell.cfg

  # Script is running as target user, no need to chown manually (which could fail without root)
  install -m 644 /tmp/tessera-shell.cfg "$KLIPPER_CFG_DIR/tessera-shell.cfg"

  local pcfg="$KLIPPER_CFG_DIR/printer.cfg"
  if [ -f "$KLIPPER_DIR/klippy/extras/gcode_shell_command.py" ]; then
    grep -qF "$KLIPPER_INCLUDE" "$pcfg" 2>/dev/null ||
      as_user "printf '%s\n%s\n' '$KLIPPER_COMMENT' '$KLIPPER_INCLUDE' >> '$pcfg'"
    log "tessera-shell.cfg included: gcode_shell_command extension found"
  else
    warn "Extension gcode_shell_command NOT found in $KLIPPER_DIR/klippy/extras/"
    warn "UI shaper/belt graphs require it. Install manually only:"
    warn "  kiauh → Install → Gcode-Shell-Command (or clone dwallrich/klipper-gcode_shell_command)"
    warn "After installing the extension, run Update — it will add $KLIPPER_INCLUDE."
    warn "File tessera-shell.cfg is already in $KLIPPER_CFG_DIR but NOT included in printer.cfg."
  fi
  warn "Klipper config changed: apply FIRMWARE_RESTART from UI/console when ready."
}

step_summary() {
  local host_ip
  host_ip=$(ip -4 route get 8.8.8.8 2>/dev/null | awk '{print $7; exit}' || true)
  [ -n "$host_ip" ] || host_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  [ -n "$host_ip" ] || host_ip="<host-ip>"
  cat <<SUMMARY

╭─ Tessera installed ─────────────────────────────────
│ UI:         http://$host_ip:$PORT/
│ dist:       ${BUILD_DIR:-}
│ extensions: $INSTALL_DIR/extensions/
│ Manage:     tessera       (update, remove, settings: branch, plugins by URL)
│ Plugins:    tessera-ext   (menu; or: tessera-ext install <name> | update --all | remove <name>)
│ From UI:    $(ui_install_summary) (Settings → Plugins)
│ By URL:     $(remote_summary)
╰───────────────────────────────────────────────────────
SUMMARY
}

# ---------------------------------------------------------------- actions
do_install() {
  if is_installed; then
    warn "Tessera is already installed in $INSTALL_DIR — Update keeps it current."
    confirm "Reinstall anyway (answer the questions again and download the build)?" || return 0
    FORCE_FETCH=1
  fi
  if interactive; then
    ask INSTALL_DIR     "Installation directory"   "$INSTALL_DIR"
    ask PORT            "nginx port for UI"        "$PORT"
    ask MOONRAKER       "Moonraker host:port"      "$MOONRAKER"
    ask KLIPPER_CFG_DIR "Klipper config directory" "$KLIPPER_CFG_DIR"
  fi
  log "branch: $BRANCH, plugins by URL: $(remote_summary), from the UI: $(ui_install_summary) — change them in Settings"
  save_conf
  step_deps
  step_fetch
  step_extensions
  step_service
  step_update_service
  step_nginx
  step_klipper
  step_summary
  if [ -t 0 ] && interactive && confirm "Open the plugin manager now?"; then
    do_extensions || warn "plugin manager exited with an error (Tessera itself is installed)"
  fi
}

do_update() {
  is_installed || die "Tessera is not installed in $INSTALL_DIR — use Install"
  save_conf   # installations made before install.conf get one now
  step_deps
  step_fetch
  step_extensions
  step_service
  step_update_service
  step_nginx
  step_klipper
  step_summary
}

do_reinstall() {
  is_installed || die "Tessera is not installed in $INSTALL_DIR — use Install"
  save_conf
  step_deps
  FORCE_FETCH=1
  step_fetch
  step_extensions
  step_service
  step_update_service
  step_nginx
  log "reinstall done — reload the UI page"
}

do_extensions() {
  is_installed || die "Install Tessera first: extensions live in $INSTALL_DIR/extensions"
  dry "bash $INSTALL_DIR/deploy/install-ext.sh menu" && return 0
  TESSERA_DIR="$INSTALL_DIR" bash "$INSTALL_DIR/deploy/install-ext.sh" menu
}

do_remove() {
  nginx_paths
  local site="$NGINX_AV/tessera" pcfg="$KLIPPER_CFG_DIR/printer.cfg" n_ext=0
  is_installed && n_ext="$(count_extensions)"
  if ! is_installed && [ ! -f "$site" ] && [ ! -f "$CMD_MENU" ] && [ ! -f "$CMD_EXT" ]; then
    warn "Tessera is not installed (nothing in $INSTALL_DIR, no nginx site, no commands)"
    return 0
  fi
  # Refuse to delete anything that does not look like a Tessera checkout.
  if is_installed; then
    case "$INSTALL_DIR" in /|"$REAL_HOME"|"$REAL_HOME/") die "refusing to delete $INSTALL_DIR";; esac
    [ -f "$INSTALL_DIR/deploy/install.sh" ] || die "$INSTALL_DIR does not look like Tessera — refusing to delete it"
  fi

  echo "The following will be removed:"
  is_installed && echo "  - $INSTALL_DIR (build, $n_ext extension(s))"
  [ -f "$UNIT_SOCKET" ] && echo "  - systemd units tessera-ext.socket, tessera-ext.service"
  [ -f "$UNIT_UPD_SOCKET" ] && echo "  - systemd units tessera-update-manager.socket, tessera-update-manager.service"
  [ -f "$site" ] && echo "  - nginx site $site${NGINX_EN:+ and $NGINX_EN/tessera}, nginx logs tessera-*.log"
  [ -f /etc/nginx/conf.d/tessera-upgrade-map.conf ] && echo "  - /etc/nginx/conf.d/tessera-upgrade-map.conf (if no other site uses it)"
  grep -qsF "$KLIPPER_INCLUDE" "$pcfg" && echo "  - $KLIPPER_INCLUDE from $pcfg (backup: printer.cfg.tessera-bak)"
  [ -f "$KLIPPER_CFG_DIR/tessera-shell.cfg" ] && echo "  - $KLIPPER_CFG_DIR/tessera-shell.cfg"
  echo "  - commands $CMD_MENU, $CMD_EXT"
  echo "  - settings $CONF_FILE"
  [ -d "$(dirname "$CONF_FILE")/services" ] && echo "  - addresses and tokens of plugin services $(dirname "$CONF_FILE")/services"
  echo "Kept: nginx, curl, python3 packages; graphs in $KLIPPER_CFG_DIR/shapers."
  echo "Tessera no longer needs Node.js: remove it yourself if nothing else uses it."
  confirm "Remove Tessera?" || { log "cancelled"; return 0; }

  local keep_ext=0
  if [ "$n_ext" -gt 0 ] && ! confirm "Delete installed extensions too?"; then keep_ext=1; fi

  # Leave the directory before deleting it (the menu may have been started there).
  cd "$REAL_HOME"

  # service: it has extensions/ mounted
  disable_service
  disable_update_service

  # nginx
  if [ -f "$site" ] || { [ -n "$NGINX_EN" ] && [ -L "$NGINX_EN/tessera" ]; }; then
    [ -n "$NGINX_EN" ] && $SUDO rm -f "$NGINX_EN/tessera"
    $SUDO rm -f "$site"
  fi
  if [ -f /etc/nginx/conf.d/tessera-upgrade-map.conf ]; then
    # Another site may rely on our $connection_upgrade map: keep it then.
    if $SUDO grep -rqs --exclude=tessera-upgrade-map.conf 'connection_upgrade' /etc/nginx; then
      warn "kept tessera-upgrade-map.conf: another nginx config uses \$connection_upgrade"
    else
      $SUDO rm -f /etc/nginx/conf.d/tessera-upgrade-map.conf
    fi
  fi
  $SUDO rm -f /var/log/nginx/tessera-access.log* /var/log/nginx/tessera-error.log*
  if command -v nginx >/dev/null 2>&1; then
    if $SUDO nginx -t >/dev/null 2>&1; then $SUDO systemctl reload nginx || true
    else warn "nginx -t fails after removal — check /etc/nginx"; fi
  fi

  # Klipper
  local klipper_changed=0
  if grep -qsF "$KLIPPER_INCLUDE" "$pcfg"; then
    if ! dry "remove $KLIPPER_INCLUDE from $pcfg"; then
      cp "$pcfg" "$pcfg.tessera-bak"
      sed -i "\\|^$KLIPPER_COMMENT\$|d; \\|^\\[include tessera-shell\\.cfg\\]\$|d" "$pcfg"
    fi
    klipper_changed=1
  fi
  dry "rm -f $KLIPPER_CFG_DIR/tessera-shell.cfg" || rm -f "$KLIPPER_CFG_DIR/tessera-shell.cfg"

  # commands, extensions, sources, settings
  $SUDO rm -f "$CMD_MENU" "$CMD_EXT"
  if is_installed; then
    if [ "$keep_ext" = 1 ]; then
      local dst="$REAL_HOME/tessera-extensions-backup"
      [ -e "$dst" ] && dst="$dst-$(date +%Y%m%d-%H%M%S)"
      dry "mv $INSTALL_DIR/extensions $dst" || mv "$INSTALL_DIR/extensions" "$dst"
      log "extensions kept in $dst"
    fi
    dry "rm -rf $INSTALL_DIR" || rm -rf "$INSTALL_DIR"
  fi
  dry "rm -f $CONF_FILE" || rm -f "$CONF_FILE"
  # Tokens of plugin services (api.services) are secrets: they do not outlive Tessera, even
  # when the extensions are kept.
  local services_dir
  services_dir="$(dirname "$CONF_FILE")/services"
  dry "rm -rf $services_dir" || rm -rf "$services_dir"

  log "Tessera removed."
  [ "$klipper_changed" = 1 ] && warn "printer.cfg changed: apply FIRMWARE_RESTART when ready."
  return 0
}

# Branches that have a published build (no clone needed).
remote_branches() {
  local slug
  slug="$(repo_slug)" || return 0
  https_get -m 15 "https://api.github.com/repos/$slug/releases?per_page=100" 2>/dev/null |
    grep -oE '"tag_name": *"build-[^"]+"' | sed 's/.*"build-//; s/"$//' | sort
}

set_branch() {
  local branches=() b choice i
  mapfile -t branches < <(remote_branches || true)
  echo
  if [ "${#branches[@]}" -gt 0 ]; then
    echo "Branches with a build in $REPO_URL:"
    for i in "${!branches[@]}"; do
      b="${branches[$i]}"
      printf '  %2d) %s%s\n' $((i + 1)) "$b" "$([ "$b" = "$BRANCH" ] && echo " ${C_G}(current)${C_0}")"
    done
  else
    warn "cannot list branches of $REPO_URL (offline?) — type the name"
  fi
  prompt_line choice "###### Branch (number or name, Enter = keep $BRANCH): " || return 0
  choice="${choice//[[:space:]]/}"
  [ -n "$choice" ] || return 0
  if [[ "$choice" =~ ^[0-9]+$ ]] && [ "${#branches[@]}" -gt 0 ]; then
    [ "$choice" -ge 1 ] && [ "$choice" -le "${#branches[@]}" ] || { echo '###### Invalid input!'; return 0; }
    choice="${branches[$((choice - 1))]}"
  elif [ "${#branches[@]}" -gt 0 ] && ! printf '%s\n' "${branches[@]}" | grep -qx -- "$choice"; then
    warn "branch '$choice' not found"; return 0
  fi
  [ "$choice" = "$BRANCH" ] && { log "branch stays $BRANCH"; return 0; }
  BRANCH="$choice"
  save_conf
  log "branch: $BRANCH"
  if is_installed && confirm "Switch the installation to $BRANCH now (Update)?"; then
    run_action do_update
  fi
}

set_plugins_policy() {
  echo
  echo "Plugins by URL: Settings → Plugins → 'Add by URL' loads plugin code from any server."
  echo "That code gets full access to the printer. Registry plugins (tessera-ext) work either way."
  if [ "$ALLOW_REMOTE" = 1 ]; then
    confirm "Block plugins by URL again (enable CSP)?" || return 0
    ALLOW_REMOTE=0
  else
    confirm "Allow plugins by URL (disables CSP, unsafe)?" || return 0
    ALLOW_REMOTE=1
  fi
  save_conf
  run_action apply_plugins_policy
}

apply_ui_install() {
  is_installed || { log "plugins from the UI: $(ui_install_summary) — applied on install"; return 0; }
  step_service
  log "plugins from the UI: $(ui_install_summary). Reload the UI page."
}

apply_ui_update() {
  is_installed || { log "update from the UI: $(ui_update_summary) — applied on install"; return 0; }
  step_update_service
  log "update from the UI: $(ui_update_summary). Reload the UI page."
}

set_ui_update() {
  echo
  echo "Update from the UI: Settings → About shows when a new build is published and updates Tessera."
  echo "A small service (tessera-update-manager.socket) does the work and runs only while it is being used."
  echo "It asks Moonraker who may do this and takes no parameters: the build comes from the configured branch."
  echo "It may write the installation directory (not nginx or systemd): some builds still need 'tessera update'."
  if [ "$UI_UPDATE" = 1 ]; then
    confirm "Disable it (Tessera is then updated with the tessera command only)?" || return 0
    UI_UPDATE=0
  else
    confirm "Enable it?" || return 0
    UI_UPDATE=1
  fi
  save_conf
  run_action apply_ui_update
}

set_ui_install() {
  echo
  echo "Plugins from the UI: Settings → Plugins installs, updates and removes plugins of the registry."
  echo "A small service (tessera-ext.socket) does the work and runs only while it is being used."
  echo "It asks Moonraker who may do this and takes nothing but a plugin id: code comes from the registry only."
  if [ "$UI_INSTALL" = 1 ]; then
    confirm "Disable it (plugins are then managed with tessera-ext only)?" || return 0
    UI_INSTALL=0
  else
    confirm "Enable it?" || return 0
    UI_INSTALL=1
  fi
  save_conf
  run_action apply_ui_install
}

# ---------------------------------------------------------------- menus
# Each action runs in a subshell: `die` ends the action, not the menu.
run_action() {
  local rc
  set +e
  ( set -e; "$@" )
  rc=$?
  set -e
  [ "$rc" -eq 0 ] || warn "action failed (exit code $rc)"
  pause
  load_settings
  return 0
}

ask_action() { # ask_action VAR — lower-cased answer; returns 1 on end of input
  local __a
  prompt_line __a '###### Perform action: ' || return 1
  __a="${__a//[[:space:]]/}"
  printf -v "$1" '%s' "${__a,,}"
}

invalid() { echo '###### Invalid input!'; }

menu_main_screen() {
  local st branch commit nginx remote ext site
  nginx_paths
  site="$NGINX_AV/tessera"
  if is_installed; then
    st="${C_G}Installed${C_0}"
    branch="$BRANCH"
    commit="$(installed_commit)"
    if [ -f "$INSTALL_DIR/build-info" ]; then commit+=" ($(build_info_get "$INSTALL_DIR/build-info" DATE))"
    else commit+=" (source checkout)"; fi
    ext="$(count_extensions) installed"
  else
    st="${C_R}Not installed${C_0}"
    branch="$BRANCH ${C_D}(will install)${C_0}"
    commit='-'
    ext='-'
  fi
  if [ -f "$site" ]; then nginx="port $(grep -oE 'listen +[0-9]+;' "$site" | head -1 | grep -oE '[0-9]+' || echo '?')"
  else nginx="${C_D}not configured${C_0}"; fi
  if [ "$ALLOW_REMOTE" = 1 ]; then remote="${C_Y}allowed${C_0}"; else remote="${C_G}blocked${C_0}"; fi

  box_top
  title 'Main Menu'
  rule2 "$J_T"
  row2 '  1) [Install]'    "   Tessera: $st"
  row2 '  2) [Update]'     "    Branch: $branch"
  row2 '  3) [Remove]'     "    Commit: $commit"
  row2 ''                  "     nginx: $nginx"
  row2_sep ''
  row2 '  S) [Settings]'   " Plugins by URL: $remote"
  row2 '  E) [Extensions]' "     Extensions: $ext"
  rule2 "$J_B"
  center 'Q) Quit'
  box_bottom
}

menu_update() {
  local a local_sha remote_sha state
  while :; do
    is_installed || { warn "Tessera is not installed — use Install"; return 0; }
    local_sha="$(installed_commit)"
    remote_sha="$(remote_commit)"
    if [ -z "$remote_sha" ]; then state="${C_R}remote unreachable${C_0}"
    elif [ "$remote_sha" = "$local_sha" ]; then state="${C_G}up to date${C_0}"
    else state="${C_Y}update available${C_0}"; fi

    box_top
    title 'Update Menu'
    rule
    row ''
    row "  Branch:    $BRANCH"
    row "  Installed: $local_sha"
    row "  Remote:    ${remote_sha:--}  $state"
    row ''
    row '  1) [Update Tessera]'
    row "     ${C_D}download $BRANCH build $ARROW nginx $ARROW Klipper config${C_0}"
    row '  2) [Reinstall]'
    row "     ${C_D}download the build again, rewrite nginx config${C_0}"
    row ''
    rule
    center "B) $BACK Back"
    box_bottom
    ask_action a || return 1
    case "$a" in
      1) run_action do_update ;;
      2) run_action do_reinstall ;;
      b) return 0 ;;
      *) invalid ;;
    esac
  done
}

menu_settings() {
  local a remote ui upd
  while :; do
    if [ "$ALLOW_REMOTE" = 1 ]; then remote="${C_Y}allowed${C_0}"; else remote="${C_G}blocked${C_0}"; fi
    if [ "$UI_INSTALL" = 1 ]; then ui="${C_G}enabled${C_0}"; else ui="${C_D}disabled${C_0}"; fi
    if [ "$UI_UPDATE" = 1 ]; then upd="${C_G}enabled${C_0}"; else upd="${C_D}disabled${C_0}"; fi
    box_top
    title 'Settings'
    rule
    row ''
    row "  1) [Branch]          ${C_C}$BRANCH${C_0}"
    row "  2) [Plugins by URL]  $remote"
    row "  3) [Plugins from UI] $ui"
    row "  4) [Update from UI]  $upd"
    row ''
    row "  ${C_D}Saved in $CONF_FILE${C_0}"
    rule
    center "B) $BACK Back"
    box_bottom
    ask_action a || return 1
    case "$a" in
      1) set_branch ;;
      2) set_plugins_policy ;;
      3) set_ui_install ;;
      4) set_ui_update ;;
      b) return 0 ;;
      *) invalid ;;
    esac
  done
}

menu_main() {
  local a
  header
  while :; do
    menu_main_screen
    ask_action a || break
    case "$a" in
      1) run_action do_install ;;
      2) menu_update || break ;;
      3) run_action do_remove ;;
      s) menu_settings || break ;;
      e) run_action do_extensions ;;
      q) break ;;
      *) invalid ;;
    esac
  done
  echo '###### Happy printing!'
}

usage() {
  cat <<USAGE
Usage: install.sh [command]
  (no command)     interactive menu (in a terminal); without a terminal: install or update
  install          install Tessera (asks directory, port, Moonraker, Klipper config dir)
  update           download the build of the configured branch, rewrite nginx/Klipper config
  reinstall        download the build again even if it is current, rewrite nginx config
  remove           uninstall Tessera completely
  extensions       open the plugin manager (tessera-ext)
  --plugins-policy change only the "plugins by URL" setting
Settings: $CONF_FILE (TESSERA_* variables override it)
USAGE
}

# ---------------------------------------------------------------- entry
load_settings

case "${1:-}" in
  install)    do_install ;;
  update)     do_update ;;
  reinstall|rebuild) do_reinstall ;;
  remove)     do_remove ;;
  extensions) do_extensions ;;
  menu)       menu_main ;;
  --plugins-policy)
    if [ -z "${TESSERA_ALLOW_REMOTE_PLUGINS:-}" ] && interactive && [ -t 0 ]; then
      set_plugins_policy
    else
      save_conf
      apply_plugins_policy
    fi ;;
  -h|--help|help) usage ;;
  '')
    if [ -t 0 ] && interactive; then menu_main
    elif is_installed; then do_update
    else do_install; fi ;;
  *) usage; exit 1 ;;
esac
