#!/bin/bash
# ============================================================
# Wings (Pterodactyl) re-setup untuk Railway panel container
# Jalankan ulang setiap kali service panel redeploy/restart
# Karena file di container Railway bersifat efemeral.
#
# Prasyarat:
#   - Railway CLI terinstall: curl -fsSL https://railway.app/install.sh | sh
#   - Token akun Railway (config.json user.token)
#   - curl + python3 lokal
# ============================================================

set -e

export PROJECT="d32512be-ed71-49f1-b8b6-610953e070e8"
export ENVIRONMENT="6ee6d296-44bb-4d2b-a796-126f6dad7497"
export SERVICE="785bdc10-f22e-498e-a4eb-bead44552a91"
export WINGS_DOMAIN="panel-production-4218.up.railway.app"   # domain Railway -> targetPort 8081
export PANEL_URL="https://panel-production-d78b.up.railway.app"
# Nilai node (dari /api/application/nodes/1/configuration):
export NODE_UUID="a4824cf9-c4a1-4df1-a53e-a661c0f8397b"
export TOKEN_ID="l3O0NjbbjSk7ZglV"
export TOKEN="EeMHhzcqxlp9RYpECJ3cQr3eBqs398oB5Sx2tjPLYPLiiyS4RCsIrTlgDS4Tf2b3"

ssh_cmd() {
  railway ssh --project="$PROJECT" --environment="$ENVIRONMENT" --service="$SERVICE" -- "$1"
}

echo "[1/5] Download wings binary..."
ssh_cmd "curl -L --silent --show-error -o /tmp/wings https://github.com/pterodactyl/wings/releases/latest/download/wings_linux_amd64 && chmod +x /tmp/wings && mv /tmp/wings /usr/local/bin/wings"

echo "[2/5] Buat direktori + config.yml (port API 8081, ssl off, CORS ke panel)..."
CFG=$(cat << EOF | base64 -w0
debug: false
uuid: ${NODE_UUID}
token_id: ${TOKEN_ID}
token: ${TOKEN}
api:
  host: 0.0.0.0
  port: 8081
  ssl:
    enabled: false
    cert: /etc/letsencrypt/live/127.0.0.1/fullchain.pem
    key: /etc/letsencrypt/live/127.0.0.1/privkey.pem
  upload_limit: 100
allowed_origins:
  - ${PANEL_URL}
allowed_ips: []
system:
  data: /var/lib/pterodactyl/volumes
  sftp:
    bind_port: 2022
remote: ${PANEL_URL}
EOF
)
ssh_cmd "mkdir -p /etc/pterodactyl /var/lib/pterodactyl/volumes /var/log/pterodactyl && echo '$CFG' | base64 -d > /etc/pterodactyl/config.yml"

echo "[3/5] Upload fake dockerd (perlu karena Railway tidak mengizinkan Docker)..."
# fake_docker.py: HTTP server di unix socket /var/run/docker.sock
# menangani /_ping, /version, /info, /containers/json, /networks/*
# script terpisah: fake_docker.py (lihat file sebelah)
FAKE=$(base64 -w0 "$(dirname "$0")/fake_docker.py")
ssh_cmd "echo '$FAKE' | base64 -d > /opt/fake_docker.py"

echo "[4/5] Daftarkan program supervisord..."
PROG=$(printf '[program:fake-docker]\ncommand=/usr/bin/python3 /opt/fake_docker.py\npriority=10\nautostart=true\nautorestart=true\nstartsecs=1\nstderr_logfile=/var/log/pterodactyl/fake-docker.log\nstdout_logfile=/var/log/pterodactyl/fake-docker.log\n\n[program:wings]\ncommand=/usr/local/bin/wings\nautostart=true\nautorestart=true\nstartsecs=5\nstderr_logfile=/var/log/pterodactyl/error.log\nstdout_logfile=/var/log/pterodactyl/wings.log\n' | base64 -w0)
ssh_cmd "printf '\n' >> /etc/supervisord.conf && echo '$PROG' | base64 -d >> /etc/supervisord.conf && supervisorctl reread && supervisorctl update"

echo "[5/5] Start + verifikasi..."
sleep 5
ssh_cmd "supervisorctl start wings; sleep 6; supervisorctl status; curl -s -w ' [%{http_code}]\n' -H 'Authorization: Bearer ${TOKEN}' http://127.0.0.1:8081/api/system"

echo ""
echo "Selesai. Node online jika curl di atas mengembalikan [200]."
echo "Cek dot hijau di: ${PANEL_URL}/admin/nodes"
echo "Ping URL browser: https://${WINGS_DOMAIN}:443/api/system"
