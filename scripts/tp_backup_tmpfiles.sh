#!/usr/bin/env bash
# Backup RailPanel ke tmpfiles.org (catatan: file expire ~60 menit)
# Usage: sh tp_backup_tmpfiles.sh /path/to/file.zip
set -e
F="$1"
[ -f "$F" ] || { echo "File tidak ketemu: $F"; exit 1; }

echo "[1/2] Upload ke tmpfiles.org ..."
RES=$(curl -s --max-time 300 -H "Expect:" -F "file=@$F" https://tmpfiles.org/api/v1/upload || echo '{"status":"curl-error"}')
echo "  resp: $(echo "$RES" | head -c 300)"

URL=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['data']['url'])" 2>/dev/null || true)
if [ -n "$URL" ]; then
  DL=$(echo "$URL" | sed 's|tmpfiles\.org/|tmpfiles.org/dl/|')
  echo "[2/2] Link:"
  echo "PAGE  : $URL"
  echo "DIRECT: $DL"
else
  echo "UPLOAD GAGAL: $RES"
  exit 1
fi
