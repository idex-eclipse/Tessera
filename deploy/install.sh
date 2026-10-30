#!/usr/bin/env bash
# Tessera installer — Armbian/Debian-first, best-effort universal.
#
# One-liner (interactive):
#   curl -fsSL https://raw.githubusercontent.com/@GH_ORG@/tessera/main/deploy/install.sh \
#     -o /tmp/tessera-install.sh && bash /tmp/tessera-install.sh
# Non-interactive:
#   TESSERA_NO_PROMPT=1 TESSERA_PORT=8080 bash /tmp/tessera-install.sh
# Update = re-run the same script (idempotent).
# Change only "plugins by URL" (no rebuild, just policy + nginx reload):
#   bash /tmp/tessera-install.sh --plugins-policy
set -euo pipefail

# ---------------------------------------------------------------- configuration
REPO_URL="${TESSERA_REPO:-https://github.com/idex-eclipse/tessera.git}"
BRANCH="${TESSERA_BRANCH:-main}"
PORT="${TESSERA_PORT:-8000}"
MOONRAKER="${TESSERA_MOONRAKER:-127.0.0.1:7125}"
SKIP_NGINX="${TESSERA_SKIP_NGINX:-0}"
SKIP_KLIPPER="${TESSERA_SKIP_KLIPPER_CFG:-0}"
NO_PROMPT="${TESSERA_NO_PROMPT:-0}"
# 1 = UI may load plugins by URL from other servers (no CSP); 0 = only /extensions/
# empty = ask, defaulting to the previous choice (extensions/policy.json)
ALLOW_REMOTE="${TESSERA_ALLOW_REMOTE_PLUGINS:-}"

log()  { printf '\033[1;34m[tessera]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[tessera]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[tessera]\033[0m %s\n' "$*" >&2; exit 1; }

ask()   { # ask VAR "question" default
  [ "$NO_PROMPT" = 1 ] && { eval "$1=\"\$3\""; return; }
  local r; read -r -p "$2 [$3]: " r || r=""
  eval "$1=\"${r:-$3}\""
}
yesno() { # yesno VAR "question" default(0|1)
  if [ "$NO_PROMPT" = 1 ]; then eval "$1=\$3"; return; fi
  local r; read -r -p "$2 [${3:-0} = no, 1 = yes]: " r || r=""
  case "${r:-$3}" in 1|y|Y|yes|YES) eval "$1=1";; *) eval "$1=0";; esac
}

# ---------------------------------------------------------------- plugins by URL policy
# CSP on the UI document: browser refuses scripts from other origins,
# so only same-origin /extensions/ plugins can be loaded. The comment marks
# the spot so --plugins-policy can toggle it in an existing nginx config.
CSP_ON="add_header Content-Security-Policy \"script-src 'self'\" always;"
CSP_OFF="# tessera: plugins by URL allowed, no CSP"

nginx_paths() {
  NGINX_AV=/etc/nginx/sites-available; NGINX_EN=/etc/nginx/sites-enabled
  [ -d /etc/nginx/sites-enabled ] || { NGINX_AV=/etc/nginx/conf.d; NGINX_EN=""; }
}

ask_allow_remote() {
  if [ -z "$ALLOW_REMOTE" ]; then
    ALLOW_REMOTE=0
    grep -qs '"allowRemotePlugins": *true' "$INSTALL_DIR/extensions/policy.json" && ALLOW_REMOTE=1
  fi
  if [ -t 0 ] && [ "$NO_PROMPT" != 1 ]; then
    log "Plugins by URL: Settings → Plugins → 'Add by URL' loads plugin code from any server."
    log "That code gets full access to the printer. Registry plugins (extensions/) work either way."
    yesno ALLOW_REMOTE "Allow installing UI plugins by URL (unsafe)?" "$ALLOW_REMOTE"
  fi
}

# policy.json only tells the UI whether to offer "Add by URL"; enforcement is the nginx CSP.
write_policy() {
  local v=false; [ "$ALLOW_REMOTE" = 1 ] && v=true
  mkdir -p "$INSTALL_DIR/extensions"
  printf '{ "allowRemotePlugins": %s }\n' "$v" > "$INSTALL_DIR/extensions/policy.json"
}

remote_summary() {
  if [ "$ALLOW_REMOTE" = 1 ]; then echo "allowed (no CSP)"; else echo "blocked by CSP"; fi
}

# ---------------------------------------------------------------- privileges/home
if [ "$(id -u)" -eq 0 ]; then
    die "Do not run this script directly as root. Run it as a regular user with sudo privileges."
fi
command -v sudo >/dev/null || die "sudo is required but not found"
SUDO="sudo"

REAL_USER="$(id -un)"
REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"; [ -n "$REAL_HOME" ] || REAL_HOME="$HOME"

INSTALL_DIR="${TESSERA_DIR:-$REAL_HOME/tessera}"
KLIPPER_CFG_DIR="${TESSERA_KLIPPER_CFG:-$REAL_HOME/printer_data/config}"
KLIPPER_DIR="${TESSERA_KLIPPER_DIR:-$REAL_HOME/klipper}"

# ---------------------------------------------------------------- --plugins-policy (quick mode)
if [ "${1:-}" = "--plugins-policy" ]; then
  [ -t 0 ] && [ "$NO_PROMPT" != 1 ] && ask INSTALL_DIR "Installation directory" "$INSTALL_DIR"
  [ -d "$INSTALL_DIR/.git" ] || die "Tessera not found in $INSTALL_DIR — run the full installer first"
  ask_allow_remote
  write_policy

  nginx_paths
  CONF="$NGINX_AV/tessera"
  if [ -f "$CONF" ] && $SUDO grep -qF -e "$CSP_ON" -e "$CSP_OFF" "$CONF"; then
    if [ "$ALLOW_REMOTE" = 1 ]; then FROM="$CSP_ON"; TO="$CSP_OFF"; else FROM="$CSP_OFF"; TO="$CSP_ON"; fi
    $SUDO sed -i "s|$FROM|$TO|g" "$CONF"
    $SUDO nginx -t || die "nginx -t failed — edit $CONF manually"
    $SUDO systemctl reload nginx
  else
    warn "no Tessera CSP marker in $CONF — re-run the full installer to apply nginx part"
  fi
  log "plugins by URL: $(remote_summary). Reload the UI page."
  exit 0
fi

if [ -t 0 ] && [ "$NO_PROMPT" != 1 ]; then
  ask INSTALL_DIR "Installation directory" "$INSTALL_DIR"
  ask BRANCH      "Git branch to install"  "$BRANCH"
  ask PORT        "nginx port for UI"      "$PORT"
  ask MOONRAKER   "Moonraker host:port"    "$MOONRAKER"
  ask KLIPPER_CFG_DIR "Klipper config directory" "$KLIPPER_CFG_DIR"
fi
ask_allow_remote

as_user() { # as_user "cmd" — always run as the printer owner
  # Since running as root is forbidden, we are always the target user
  bash -c "$1"
}

# ---------------------------------------------------------------- dependencies
if command -v apt-get >/dev/null 2>&1; then
  log "checking system packages (git/curl/nginx)"
  MISS=""
  for p in git curl nginx; do command -v "$p" >/dev/null 2>&1 || MISS="$MISS $p"; done
  if [ -n "$MISS" ]; then
    $SUDO apt-get update -qq || true
    # shellcheck disable=SC2086
    $SUDO apt-get install -y $MISS
  fi
else
  warn "non-Debian family: auto package install skipped."
  warn "ensure manually: git, curl, nginx, node>=18, then re-run this script."
fi

node_major() { node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/'; }
if ! { command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 18 ]; }; then
  if command -v apt-get >/dev/null 2>&1; then
    log "node <18 or missing — installing Node.js 20 (NodeSource)"
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
    $SUDO apt-get install -y nodejs
  else
    die "need Node.js >= 18: install manually and re-run"
  fi
fi
{ command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 18 ]; } || die "node >= 18 unavailable"
command -v npm >/dev/null 2>&1 || die "npm not found"

MEM_KB="$(awk '/MemTotal/{print $2}' /proc/meminfo)"
if [ "$MEM_KB" -lt 1200000 ] && ! $SUDO swapon --show 2>/dev/null | grep -q .; then
  warn "RAM < 1.2G and no swap: vite build may OOM."
  warn "Recommended: sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
fi

# ---------------------------------------------------------------- clone + build
if [ -d "$INSTALL_DIR/.git" ]; then
  log "repository already exists — updating to $BRANCH"
  # We use FETCH_HEAD instead of origin/<branch> to avoid 'non-fast-forward' errors
  # that occur when switching between shallow-cloned remote tracking branches.
  as_user "cd '$INSTALL_DIR' && git fetch --depth 1 origin '$BRANCH' && git checkout -f -B '$BRANCH' FETCH_HEAD"
else
  log "cloning $REPO_URL ($BRANCH) → $INSTALL_DIR"
  as_user "git clone --depth 1 -b '$BRANCH' '$REPO_URL' '$INSTALL_DIR'"
fi

log "dependencies + build (may take several minutes on SBC)"
as_user "cd '$INSTALL_DIR' && (npm ci --no-audit --no-fund || npm install --no-audit --no-fund)"
as_user "cd '$INSTALL_DIR' && npm run build"

BUILD_DIR=""
for c in host/dist dist build host/build; do
  [ -f "$INSTALL_DIR/$c/index.html" ] && { BUILD_DIR="$INSTALL_DIR/$c"; break; }
done
[ -n "$BUILD_DIR" ] || die "build output not found (checked host/dist, dist, build)"
case "$BUILD_DIR" in
  "$REAL_HOME"/*) chmod a+x "$REAL_HOME" 2>/dev/null || true
                  warn "home directory made traversable (nginx reads dist from home)";;
esac

# ---------------------------------------------------------------- extensions
write_policy
as_user "cd '$INSTALL_DIR' && node tools/extensions-sync.cjs" || warn "extensions index not generated"

# `tessera-ext` command: plugin manager (deploy/install-ext.sh) bound to this installation.
EXT_CMD=/usr/local/bin/tessera-ext
{
  printf '#!/usr/bin/env bash\n'
  printf '# Installed by Tessera deploy/install.sh — plugin manager for %s\n' "$INSTALL_DIR"
  printf 'export TESSERA_DIR="${TESSERA_DIR:-%s}"\n' "$INSTALL_DIR"
  printf 'exec bash %q "$@"\n' "$INSTALL_DIR/deploy/install-ext.sh"
} > /tmp/tessera-ext-cmd
if $SUDO install -m 755 /tmp/tessera-ext-cmd "$EXT_CMD"; then
  log "plugin manager: tessera-ext"
else
  warn "could not create $EXT_CMD — use: bash $INSTALL_DIR/deploy/install-ext.sh"
fi
rm -f /tmp/tessera-ext-cmd

# ---------------------------------------------------------------- nginx
if [ "$SKIP_NGINX" != 1 ]; then
  if command -v ss >/dev/null 2>&1 && ss -ltn | awk '{print $4}' | grep -qE "[:.]${PORT}$"; then
    warn "port $PORT is already in use"
    yesno PORT_OK "Continue anyway (conflict will show in nginx -t)?" 0
    [ "$PORT_OK" = 1 ] || { ask PORT "New port" "8081"; }
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
  CSP_LINE="$CSP_ON"; [ "$ALLOW_REMOTE" = 1 ] && CSP_LINE="$CSP_OFF"
  sed -i "s|@PORT@|$PORT|g; s|@MOONRAKER@|$MOONRAKER|g; s|@BUILD_DIR@|$BUILD_DIR|g; s|@INSTALL_DIR@|$INSTALL_DIR|g; s|@CSP@|$CSP_LINE|g" \
    /tmp/tessera-nginx.conf

  nginx_paths
  $SUDO install -m 644 /tmp/tessera-nginx.conf "$NGINX_AV/tessera"
  [ -n "$NGINX_EN" ] && $SUDO ln -sf "$NGINX_AV/tessera" "$NGINX_EN/tessera"
  $SUDO nginx -t || die "nginx -t failed — edit $NGINX_AV/tessera manually"
  $SUDO systemctl reload nginx
  log "nginx: http://<host-ip>:$PORT/"
else
  warn "SKIP_NGINX=1: configure dist serving and proxy yourself (root=$BUILD_DIR)"
fi

# ---------------------------------------------------------------- Klipper config
if [ "$SKIP_KLIPPER" != 1 ] && [ -d "$KLIPPER_CFG_DIR" ]; then
  mkdir -p "$KLIPPER_CFG_DIR/shapers"

  cat > /tmp/tessera-shell.cfg <<'CFG'
# Tessera — shaper/belt graphs via gcode_shell_command.
# REQUIRES Klipper extension "gcode_shell_command" (install manually via kiauh!).
# UI sends RUN_SHELL_COMMAND CMD=tessera_graph_x|tessera_graph_y|tessera_graph_belts
# after TEST_RESONANCES … OUTPUT=raw_data; csv is cleaned AFTER graph generation.
[gcode_shell_command generate_x_shaper_graph]
command: mkdir -p @CFG_DIR@/shapers && bash -c @KLIPPER_DIR@/scripts/calibrate_shaper.py /tmp/*_x*.csv -o @CFG_DIR@/shapers/x_$(date +%Y%m%d-%H%M%S).png && rm -f /tmp/*_x*_axis.csv
timeout: 180
verbose: True

[gcode_shell_command generate_y_shaper_graph]
command: mkdir -p @CFG_DIR@/shapers && bash -c @KLIPPER_DIR@/scripts/calibrate_shaper.py /tmp/*_y*.csv -o @CFG_DIR@/shapers/y_$(date +%Y%m%d-%H%M%S).png && rm -f /tmp/*_y*.csv
timeout: 180
verbose: True

[gcode_shell_command generate_belts_graph]
command: mkdir -p @CFG_DIR@/shapers && python3 @KLIPPER_DIR@/scripts/graph_accelerometer.py /tmp/*_data*.csv -o @CFG_DIR@/shapers/belts_$(date +%Y%m%d-%H%M%S).png && rm -f /tmp/*_data*.csv
timeout: 180
verbose: True
CFG
  sed -i "s|@CFG_DIR@|$KLIPPER_CFG_DIR|g; s|@KLIPPER_DIR@|$KLIPPER_DIR|g" /tmp/tessera-shell.cfg

  # Script is running as target user, no need to chown manually (which could fail without root)
  install -m 644 /tmp/tessera-shell.cfg "$KLIPPER_CFG_DIR/tessera-shell.cfg"

  PCFG="$KLIPPER_CFG_DIR/printer.cfg"
  if [ -f "$KLIPPER_DIR/klippy/extras/gcode_shell_command.py" ]; then
    grep -qF '[include tessera-shell.cfg]' "$PCFG" 2>/dev/null ||
      as_user "printf '# Tessera shell graphs (extension found)\n[include tessera-shell.cfg]\n' >> '$PCFG'"
    log "tessera-shell.cfg included: gcode_shell_command extension found"
  else
    warn "Extension gcode_shell_command NOT found in $KLIPPER_DIR/klippy/extras/"
    warn "UI shaper/belt graphs require it. Install manually only:"
    warn "  kiauh → Install → Gcode-Shell-Command (or clone dwallrich/klipper-gcode_shell_command)"
    warn "After installing the extension, re-run this installer — it will add [include tessera-shell.cfg]."
    warn "File tessera-shell.cfg is already in $KLIPPER_CFG_DIR but NOT included in printer.cfg."
  fi
  warn "Klipper config changed: apply FIRMWARE_RESTART from UI/console when ready."
else
  warn "Klipper config skipped (SKIP_KLIPPER=1 or no $KLIPPER_CFG_DIR)"
fi

# ---------------------------------------------------------------- summary
HOST_IP=$(ip -4 route get 8.8.8.8 2>/dev/null | awk '{print $7; exit}')
if [ -z "$HOST_IP" ]; then
  HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
[ -z "$HOST_IP" ] && HOST_IP="<host-ip>"

cat <<SUMMARY

╭─ Tessera installed ─────────────────────────────────
│ UI:         http://$HOST_IP:$PORT/
│ dist:       $BUILD_DIR
│ extensions: $INSTALL_DIR/extensions/
│ Plugins:    tessera-ext   (menu; or: tessera-ext install <name> | update --all | remove <name>)
│ By URL:     $(remote_summary) — change: bash /tmp/tessera-install.sh --plugins-policy
│ Update:     bash /tmp/tessera-install.sh (or re-download) — idempotent
│ Uninstall:  remove sites-enabled/tessera symlink, '[include tessera*.cfg]'
│             lines from printer.cfg, /usr/local/bin/tessera-ext and directory $INSTALL_DIR
╰───────────────────────────────────────────────────────
SUMMARY

if [ -t 0 ] && [ "$NO_PROMPT" != 1 ]; then
  yesno OPEN_EXT "Open the plugin manager now?" 0
  if [ "$OPEN_EXT" = 1 ]; then
    bash "$INSTALL_DIR/deploy/install-ext.sh" menu || warn "plugin manager exited with an error (Tessera itself is installed)"
  fi
fi