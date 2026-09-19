#!/bin/bash
# Poll status deployment RailPanel via GraphQL Railway
# usage: tp-poll-deploy.sh <deploymentId>
set -u
ID="${1:?deployment id wajib}"
TOKEN="d7d841f5-c15a-42c5-be66-1795d526620a"
for i in $(seq 1 60); do
  RES=$(curl -s --max-time 30 "https://back.railway.app/graphql/v2" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"query\":\"query(\$id: String!) { deployment(id: \$id) { status buildLogs } }\",\"variables\":{\"id\":\"$ID\"}}")
  ST=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['data']['deployment']['status'])" 2>/dev/null)
  echo "[$i] status: $ST"
  case "$ST" in
    SUCCESS) echo "DEPLOY SUCCESS"; exit 0 ;;
    FAILED|CRASHED|REMOVED) echo "DEPLOY GAGAL: $ST"; echo "$RES" | head -c 2000; exit 1 ;;
  esac
  sleep 15
done
echo "TIMEOUT polling"
exit 1
