#!/usr/bin/env bash
# ==============================================================
#  WINGS RAILWAY SETUP v4 — Termux Edition
#  v3: cek DNS/internet sebelum auth + auto-retry jaringan
#      + auto-benerin DNS (resolv-conf) + shim getconf
#  v4: FIX UTAMA — railway CLI = binary STATIS (musl), gak pake DNS
#      Android, dia baca /etc/resolv.conf sendiri (gak ada di Termux
#      polos -> "dns error Try again" padahal curl normal).
#      Fix: bikin resolv.conf + auto pindah ke termux-chroot (proot)
#  ------------------------------------------------------------
#  Re-install Wings + Fake Docker daemon di container panel
#  Pterodactyl (Railway). Jalankan lagi SETIAP KALI service
#  panel redeploy (file container efemeral, DB panel tetap).
#
#  Fitur:
#   - Interaktif: paste token dll (Enter = pakai default)
#   - Self-healing: config wings di-restore otomatis tiap start
#     (kebal config-push panel yang suka nimpuk port/SSL)
#   - Tidak butuh API panel (aman dari enforcement 2FA)
#
#  Pemakaian di Termux:
#    pkg install curl bash coreutils -y
#    bash wings-termux-setup.sh
#
#  Kalau node di panel HILANG (DB baru), bikin manual dulu di
#  Panel > Admin > Nodes > Create, lalu isi input uuid/token.
# ==============================================================

R="\033[1;31m"; G="\033[1;32m"; Y="\033[1;33m"; B="\033[1;36m"; N="\033[0m"
info() { echo -e "${B}[i]${N} $1"; }
ok()   { echo -e "${G}[+]${N} $1"; }
warn() { echo -e "${Y}[!]${N} $1"; }
fail() { echo -e "${R}[x] $1${N}"; exit 1; }

# pola error jaringan (buat bedain "internet bermasalah" vs "token salah")
NET_PAT='dns error|error sending request|Failed to fetch|Try again|Temporary failure|timed out|timeout|connection refused|Connection reset|unreachable|No address associated|Name or service not known'

die_net() {
  echo
  echo -e "${R}[x] HP lo GAGAL ngobrol sama server Railway (backboard.railway.com)${N}"
  echo -e "${R}    Ini masalah DNS/internet di HP, BUKAN token lo.${N}"
  echo -e "    Token aman & belum dipakai login ke mana-mana."
  echo
  echo -e "${Y}    Coba salah satu ini, lalu jalanin script lagi:${N}"
  echo -e "     1. Mode pesawat ON 10 detik -> OFF (refresh koneksi)"
  echo -e "     2. Ganti jaringan: WiFi <-> kuota data"
  echo -e "     3. Android: Settings > Network > Private DNS > hostname -> isi ${B}dns.google${N}"
  echo -e "        (atau ${B}one.one.one.one${N})"
  echo -e "     4. VPN/proxy jalan? matiin dulu, atau: ${B}export HTTPS_PROXY=http://127.0.0.1:PORT${N}"
  echo -e "     5. Tes manual: ${B}curl -s -o /dev/null -w '%{http_code}' https://backboard.railway.com/${N}"
  echo -e "        keluar angka (200/403/404) = konek, tinggal jalanin script lagi"
  echo -e "     6. DNS binary statis: ${B}echo 'nameserver 8.8.8.8' > \$PREFIX/etc/resolv.conf${N}"
  echo -e "     7. Manual chroot: ${B}pkg install proot && termux-chroot bash wings-termux-setup.sh${N}"
  echo
  exit 1
}

chroot_rescue() {
  [ -n "$PREFIX" ] || return 1
  [ "$IN_CHROOT" = "1" ] && return 1  # udah di chroot, jangan loop
  info "Binary railway gak bisa DNS di Termux polos (binary musl statis)."
  info "Auto pindah ke termux-chroot biar bisa baca /etc/resolv.conf..."
  command -v termux-chroot >/dev/null 2>&1 || pkg install -y proot >/dev/null 2>&1 || true
  command -v termux-chroot >/dev/null 2>&1 || { warn "Gagal install proot (pkg install proot)"; return 1; }
  cp -f "$SCRIPT_PATH" "$HOME/.wings-setup.sh" 2>/dev/null || return 1
  info "Kredensial otomatis dibawa — tunggu..."
  sleep 1
  exec env AUTO_FILL=1 IN_CHROOT=1 termux-chroot bash "$HOME/.wings-setup.sh"
}

ask() { # ask VAR "pertanyaan" "default"
  local v
  if [ "$AUTO_FILL" = "1" ] && [ -n "${!1:-}" ]; then
    return   # kredensial dibawa dari sesi sebelumnya (chroot rescue)
  fi
  read -r -p "$(echo -e "${B}?$N $2 ${Y}[${3:-}]: ${N}")" v
  v="${v%$'\r'}"           # buang CR (paste dari HP)
  v="${v%\"}"; v="${v#\"}" # buang kutip
  eval "$1=\"\${v:-$3}\""
}

SCRIPT_PATH="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"

echo -e "${B}"
echo "  ============================================"
echo "   WINGS RAILWAY SETUP v4 (Termux)"
echo "   wings + fake dockerd + self-healing"
echo "  ============================================"
echo -e "${N}"

# ---------------- INPUT ----------------
echo -e "${Y}--- INPUT (paste / Enter = default) ---${N}"
[ "$AUTO_FILL" = "1" ] && info "Pakai kredensial dari sesi sebelumnya (auto)..."
ask RAILWAY_TOKEN "Railway ACCOUNT token" "d7d841f5-c15a-42c5-be66-1795d526620a"
ask PANEL_URL     "URL panel" "https://panel-production-d78b.up.railway.app"
ask PROJECT_ID    "Project ID"    "d32512be-ed71-49f1-b8b6-610953e070e8"
ask ENV_ID        "Environment ID" "6ee6d296-44bb-4d2b-a796-126f6dad7497"
ask SERVICE_ID    "Service ID"    "785bdc10-f22e-498e-a4eb-bead44552a91"
ask WINGS_DOMAIN  "Domain publik wings (domain Railway -> port 8081)" "panel-production-4218.up.railway.app"
echo -e "${Y}--- Kredensial node (dari panel admin > node > Auto Deploy / configuration) ---${N}"
ask NODE_UUID  "Node UUID"  "a4824cf9-c4a1-4df1-a53e-a661c0f8397b"
ask TOKEN_ID   "Token ID"   "l3O0NjbbjSk7ZglV"
ask NODE_TOKEN "Token"      "EeMHhzcqxlp9RYpECJ3cQr3eBqs398oB5Sx2tjPLYPLiiyS4RCsIrTlgDS4Tf2b3"

PANEL_URL="${PANEL_URL%/}"

# ---------------- DEPENDENCY ----------------
echo; echo -e "${Y}--- DEPENDENCY ---${N}"
command -v curl   >/dev/null 2>&1 || fail "pkg install curl -y"
command -v base64 >/dev/null 2>&1 || fail "pkg install coreutils -y"

# pkg opsional: getconf (buat installer railway) + resolv-conf (bantu DNS)
pkg install -y getconf resolv-conf >/dev/null 2>&1 || true
# shim getconf kalau paketnya gak tersedia (biar installer railway gak lotso)
if ! command -v getconf >/dev/null 2>&1 && [ -n "$PREFIX" ]; then
  case "$(uname -m)" in *64*) LB=64 ;; *) LB=32 ;; esac
  mkdir -p "$PREFIX/bin"
  printf '#!/data/data/com.termux/files/usr/bin/sh\ncase "$1" in LONG_BIT) echo %s;; *) : ;; esac\n' "$LB" > "$PREFIX/bin/getconf"
  chmod +x "$PREFIX/bin/getconf" && info "Shim getconf dibuat (LONG_BIT=$LB)"
fi

# resolv.conf utk binary STATIS (musl) macem railway CLI — dia gak pake
# DNS bawaan Android, dia baca /etc/resolv.conf sendiri. Tanpa file ini
# = "dns error ... Try again" padahal curl normal (classic Termux).
if [ -n "$PREFIX" ] && [ ! -s "$PREFIX/etc/resolv.conf" ]; then
  mkdir -p "$PREFIX/etc"
  printf 'nameserver 8.8.8.8\nnameserver 8.8.4.4\nnameserver 1.1.1.1\n' > "$PREFIX/etc/resolv.conf" \
    && info "resolv.conf dibuat ($PREFIX/etc/resolv.conf)"
fi

export PATH="$HOME/.railway/bin:$PATH"
export RAILWAY_NO_TELEMETRY=1
if ! command -v railway >/dev/null 2>&1; then
  info "Install Railway CLI (pinned 4.5.4)..."
  export RAILWAY_VERSION=4.5.4
  curl -fsSL https://railway.app/install.sh | sh || fail "Gagal install railway CLI"
  unset RAILWAY_VERSION
  export PATH="$HOME/.railway/bin:$PATH"
  hash -r
fi
grep -q '.railway/bin' ~/.bashrc 2>/dev/null || echo 'export PATH="$HOME/.railway/bin:$PATH"' >> ~/.bashrc
ok "Railway CLI: $(railway --version)"

# ---------------- CEK JARINGAN ----------------
echo; echo -e "${Y}--- CEK JARINGAN (DNS HP -> API Railway) ---${N}"
NET_OK=0
for i in 1 2 3 4 5; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 8 --max-time 20 https://backboard.railway.com/ 2>"$HOME/.dnserr")
  if [ -n "$CODE" ] && [ "$CODE" != "000" ]; then
    NET_OK=1; ok "API Railway terjangkau (HTTP $CODE, percobaan $i/5)"; break
  fi
  warn "DNS/internet bermasalah (percobaan $i/5): $(head -1 "$HOME/.dnserr" 2>/dev/null)"
  [ "$i" = "2" ] && { info "Coba perbaiki DNS otomatis (resolv-conf)..."; pkg install -y resolv-conf >/dev/null 2>&1 || true; }
  sleep 3
done
rm -f "$HOME/.dnserr"
[ "$NET_OK" = "1" ] || die_net

# ---------------- AUTH RAILWAY ----------------
echo; echo -e "${Y}--- AUTH RAILWAY ---${N}"
mkdir -p ~/.railway
[ -f ~/.railway/config.json ] && cp ~/.railway/config.json ~/.railway/config.json.bak
cat > ~/.railway/config.json <<EOF
{
  "projects": {},
  "user": { "token": "$RAILWAY_TOKEN" },
  "lastUpdateCheck": "2026-01-01T00:00:00.000000000Z",
  "newVersionAvailable": null
}
EOF
AUTH_OK=0
for i in 1 2 3 4 5; do
  WHO=$(railway whoami 2>&1) && { AUTH_OK=1; break; }
  if printf '%s' "$WHO" | grep -qiE "$NET_PAT"; then
    warn "Jaringan flaky ke API Railway (percobaan $i/5): $(printf '%s' "$WHO" | head -1)"
    [ "$i" = "2" ] && chroot_rescue   # DNS binary statis rusak -> pindah chroot
    sleep 5
  else
    fail "Token Railway ditolak oleh server: $WHO"
  fi
done
[ "$AUTH_OK" = "1" ] || die_net
ok "$WHO"

ssh_cmd() {
  local out rc i
  for i in 1 2 3; do
    out=$(railway ssh --project="$PROJECT_ID" --environment="$ENV_ID" --service="$SERVICE_ID" -- "$1" 2>&1); rc=$?
    [ $rc -eq 0 ] && { printf '%s\n' "$out"; return 0; }
    if printf '%s' "$out" | grep -qiE "$NET_PAT"; then
      warn "Koneksi ke Railway flaky (percobaan $i/3): $(printf '%s' "$out" | head -1)"
      sleep 5
    else
      printf '%s\n' "$out"; return $rc
    fi
  done
  printf '%s\n' "$out"; return $rc
}

# ---------------- SETUP CONTAINER ----------------
echo; echo -e "${Y}--- SETUP DI CONTAINER ---${N}"

info "[1/6] Download wings binary..."
ssh_cmd 'curl -L --silent --show-error -o /tmp/wings https://github.com/pterodactyl/wings/releases/latest/download/wings_linux_amd64 && chmod +x /tmp/wings && mv /tmp/wings /usr/local/bin/wings' \
  || fail "Gagal download wings"
ok "$(ssh_cmd '/usr/local/bin/wings version 2>&1 | head -1')"

info "[2/6] Tulis config MASTER (port 8081, SSL off, CORS panel)..."
CFG_B64=$(cat <<EOF | base64 -w0
debug: false
uuid: $NODE_UUID
token_id: $TOKEN_ID
token: $NODE_TOKEN
api:
  host: 0.0.0.0
  port: 8081
  ssl:
    enabled: false
    cert: /etc/letsencrypt/live/127.0.0.1/fullchain.pem
    key: /etc/letsencrypt/live/127.0.0.1/privkey.pem
  upload_limit: 100
allowed_origins:
  - $PANEL_URL
allowed_ips: []
system:
  data: /var/lib/pterodactyl/volumes
  sftp:
    bind_port: 2022
remote: $PANEL_URL
EOF
)
ssh_cmd "mkdir -p /etc/pterodactyl /var/lib/pterodactyl/volumes /var/log/pterodactyl && echo '$CFG_B64' | base64 -d > /etc/pterodactyl/config.master.yml" \
  || fail "Gagal tulis config master"
ok "config.master.yml OK"

info "[3/6] Upload fake dockerd..."
FAKE_B64=$(cat <<'PYEOF' | base64 -w0
#!/usr/bin/env python3
import json, os, socket
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
SOCKET = "/var/run/docker.sock"
API_VER = "1.47"
ENGINE_VER = "27.3.1"
VERSION_INFO = {
    "Platform": {"Name": "Docker Engine - Community (fake)"},
    "Components": [{"Name": "Engine", "Version": ENGINE_VER, "Details": {
        "ApiVersion": API_VER, "MinAPIVersion": "1.24", "GitCommit": "fake0000",
        "GoVersion": "go1.22.7", "Os": "linux", "Arch": "amd64",
        "KernelVersion": "6.8.0-fake", "BuildTime": "2024-09-20T11:41:11Z"}}],
    "Version": ENGINE_VER, "ApiVersion": API_VER, "MinAPIVersion": "1.24",
    "GitCommit": "fake0000", "GoVersion": "go1.22.7", "Os": "linux",
    "Arch": "amd64", "KernelVersion": "6.8.0-fake", "BuildTime": "2024-09-20T11:41:11Z",
}
NETWORK = {
    "Name": "pterodactyl_nw",
    "Id": "fakenet0000000000000000000000000000000000000000000000000000000000",
    "Created": "2024-09-20T11:41:11Z", "Scope": "local", "Driver": "bridge",
    "EnableIPv6": False,
    "IPAM": {"Driver": "default", "Options": None,
             "Config": [{"Subnet": "172.18.0.0/16", "Gateway": "172.18.0.1"}]},
    "Internal": False, "Attachable": False, "Ingress": False,
    "ConfigFrom": {"Network": ""}, "ConfigOnly": False,
    "Containers": {}, "Options": {}, "Labels": {},
}
INFO = {
    "ID": "FAKE:DOCKER:RAILWAY", "Containers": 0, "ContainersRunning": 0,
    "ContainersPaused": 0, "ContainersStopped": 0, "Images": 0, "Driver": "overlay2",
    "MemoryLimit": True, "SwapLimit": True, "CpuCfsPeriod": True, "CpuCfsQuota": True,
    "Debug": False, "NFd": 20, "NGoroutines": 30, "LoggingDriver": "json-file",
    "OperatingSystem": "Alpine Linux (fake dockerd)", "OSType": "linux",
    "ServerVersion": ENGINE_VER, "Architecture": "x86_64", "NCPU": 1,
    "MemTotal": 1073741824, "DockerRootDir": "/var/lib/docker", "Name": "railway-wings",
    "Plugins": {"Volume": ["local"], "Network": ["bridge", "host", "null"],
                "Authorization": None, "Log": ["json-file"]},
}
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def _send(self, code, body, ctype="application/json", extra=None):
        data = json.dumps(body).encode() if isinstance(body, (dict, list)) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {}).items(): self.send_header(k, str(v))
        self.end_headers()
        if self.command != "HEAD": self.wfile.write(data)
    def _route(self):
        p = self.path
        parts = p.split("/", 2)
        if len(parts) == 3 and parts[1].startswith("v"): p = "/" + parts[2]
        if p in ("/_ping", "/_ping/"):
            return self._send(200, "OK", "text/plain", {
                "Api-Version": API_VER, "Docker-Experimental": "false",
                "Ostype": "linux", "Builder-Version": "1", "Cache-Control": "no-cache"})
        if p == "/version": return self._send(200, VERSION_INFO)
        if p == "/containers/json": return self._send(200, [])
        if p == "/networks": return self._send(200, [NETWORK])
        if p.startswith("/networks/create"):
            return self._send(201, {"Id": NETWORK["Id"], "Warning": ""})
        if p == "/networks/prune": return self._send(200, {"Networks": []})
        if p.startswith("/networks/"): return self._send(200, NETWORK)
        if p == "/info": return self._send(200, INFO)
        if p.startswith("/events"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers(); self.close_connection = True; return
        return self._send(501, {"message": "fake dockerd: not supported (%s)" % p})
    def do_GET(self): self._route()
    def do_HEAD(self): self._route()
    def do_POST(self): self._route()
    def do_DELETE(self): self._route()
class UnixHTTPServer(ThreadingMixIn, HTTPServer):
    address_family = socket.AF_UNIX
    daemon_threads = True
    def server_bind(self):
        try: os.unlink(SOCKET)
        except FileNotFoundError: pass
        HTTPServer.server_bind(self)
if __name__ == "__main__":
    os.makedirs(os.path.dirname(SOCKET), exist_ok=True)
    srv = UnixHTTPServer(SOCKET, Handler)
    os.chmod(SOCKET, 0o666)
    print("fake dockerd listening on " + SOCKET, flush=True)
    srv.serve_forever()
PYEOF
)
ssh_cmd "echo '$FAKE_B64' | base64 -d > /opt/fake_docker.py" || fail "Gagal upload fake_docker.py"
ok "fake dockerd OK"

info "[4/6] Buat wrapper self-healing..."
WRAP_B64=$(printf '#!/bin/sh\n# restore config master (kebal config-push panel) lalu jalankan wings\ncp /etc/pterodactyl/config.master.yml /etc/pterodactyl/config.yml\nexec /usr/local/bin/wings\n' | base64 -w0)
ssh_cmd "echo '$WRAP_B64' | base64 -d > /usr/local/bin/wings-safe.sh && chmod +x /usr/local/bin/wings-safe.sh" \
  || fail "Gagal buat wrapper"
ok "wings-safe.sh OK"

info "[5/6] Daftarkan ke supervisord..."
PROG_B64=$(printf '[program:fake-docker]\ncommand=/usr/bin/python3 /opt/fake_docker.py\npriority=10\nautostart=true\nautorestart=true\nstartsecs=1\nstderr_logfile=/var/log/pterodactyl/fake-docker.log\nstdout_logfile=/var/log/pterodactyl/fake-docker.log\n\n[program:wings]\ncommand=/usr/local/bin/wings-safe.sh\nautostart=true\nautorestart=true\nstartsecs=5\nstderr_logfile=/var/log/pterodactyl/error.log\nstdout_logfile=/var/log/pterodactyl/wings.log\n' | base64 -w0)
ssh_cmd "sed -i '/\[program:fake-docker\]/,/^$/d; /\[program:wings\]/,/^$/d' /etc/supervisord.conf; printf '\n' >> /etc/supervisord.conf && echo '$PROG_B64' | base64 -d >> /etc/supervisord.conf; supervisorctl reread; supervisorctl update" \
  || fail "Gagal daftar supervisord"
ok "supervisord OK"

info "[6/6] Start + verifikasi..."
ssh_cmd "supervisorctl restart fake-docker 2>/dev/null; supervisorctl restart wings 2>/dev/null; sleep 8; supervisorctl status"
LOCAL=$(ssh_cmd "curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer $NODE_TOKEN' http://127.0.0.1:8081/api/system")
[ "$LOCAL" = "200" ] || fail "Wings lokal gak 200 (dapat $LOCAL). Debug: ssh_cmd 'tail -30 /var/log/pterodactyl/error.log'"
ok "Wings API lokal: 200"

# ---------------- VERIFIKASI PUBLIK ----------------
echo; echo -e "${Y}--- VERIFIKASI PUBLIK (ping ala browser) ---${N}"
EDGE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $NODE_TOKEN" "https://$WINGS_DOMAIN/api/system")
if [ "$EDGE" = "200" ]; then
  ok "https://$WINGS_DOMAIN/api/system -> 200"
else
  warn "Domain publik: $EDGE"
  warn "Kalau 502/timeout: bikin ulang domain di Railway Dashboard:"
  warn "  Service panel > Settings > Networking > Generate Domain > port 8081"
fi

echo
echo -e "${G}===========================================${N}"
echo -e "${G}  SELESAI!${N}"
echo -e "${G}===========================================${N}"
echo -e "  Buka: ${B}$PANEL_URL/admin/nodes${N}"
echo -e "  Icon heartbeat harus ${G}HIJAU${N} (hover = versi wings)."
echo
echo -e "  ${Y}Catatan:${N}"
echo -e "  - Panel lagi maksa 2FA? Enroll dulu di ${B}$PANEL_URL/account${N}"
echo -e "    (boleh dimatikan lagi lewat DB setting '2fa_required')"
echo -e "  - Start/stop server game tetap gak bisa (batasan Railway)"
echo -e "  - Redeploy container = jalanin script ini lagi"
echo
