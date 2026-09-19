#!/usr/bin/env bash
# Backup RailPanel ke Gofile (guest account API)
# Usage: sh tp_backup_gofile.sh /path/to/file.zip
set -e
F="$1"
[ -f "$F" ] || { echo "File tidak ketemu: $F"; exit 1; }

API="https://api.gofile.io"

# Token opsional via arg 2 (reuse guest account)
TOKEN="$2"

if [ -z "$TOKEN" ]; then
  echo "[1/4] Bikin guest account Gofile..."
  ACC=$(curl -s --max-time 30 -X POST "$API/accounts" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d '{}')
  echo "  resp: $(echo "$ACC" | head -c 300)"
  TOKEN=$(echo "$ACC" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['data']['token'])" 2>/dev/null || true)
else
  echo "[1/4] Reuse token: $TOKEN"
fi

if [ -z "$TOKEN" ]; then
  echo "[!] Gagal dapat token"; exit 1
fi

echo "[2/4] Ambil daftar server upload..."
SRV_RES=$(curl -s --max-time 30 "$API/servers")
echo "  resp: $(echo "$SRV_RES" | head -c 300)"
SERVER=$(echo "$SRV_RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
s = d.get('data', {}).get('servers') or d.get('data') or []
print(s[0]['name'] if s else '')
" 2>/dev/null || true)
[ -z "$SERVER" ] && SERVER="upload"

UP="https://$SERVER.gofile.io/uploadfile"
echo "[3/4] Upload ke $UP ..."

UP_RES=""
OK=0
for i in 1 2 3; do
  echo "  percobaan $i/3 ..."
  UP_RES=$(curl -s --http1.1 --max-time 240 -H "Expect:" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@$F" "$UP" || echo '{"status":"curl-error"}')
  if echo "$UP_RES" | grep -q '"status":"ok"'; then OK=1; break; fi
  echo "  gagal: $(echo "$UP_RES" | head -c 200)"; sleep 3
done
[ "$OK" = "1" ] || { echo "[!] Upload gagal 3x"; exit 1; }

echo "[4/4] Response server:"
echo "$UP_RES"
echo ""
echo "$UP_RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('status') == 'ok':
    dd = d['data']
    print('DOWNLOAD_PAGE:', dd.get('downloadPage', '-'))
    for k, v in dd.get('files', {}).items() if isinstance(dd.get('files'), dict) else []:
        print('DIRECT_LINK :', v.get('link', '-'))
else:
    print('UPLOAD GAGAL:', d)
"
