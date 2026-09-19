#!/usr/bin/env bash
# Buat project + service + volume railpanel via GraphQL Railway (skema 2026: pakai input)
set -e
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.railway/config.json','utf8')).user.token)")
EP="https://backboard.railway.com/graphql/v2"

gq() {
  curl -s "$EP" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"query\": $(node -e "console.log(JSON.stringify(process.argv[1]))" "$1")}"
}
J() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);if(j.errors){console.error('ERR:',JSON.stringify(j.errors));process.exit(1)};console.log(eval(process.argv[1])??'')}catch(e){console.error('PARSE:',e.message,d.slice(0,200));process.exit(1)}})" "$1"; }

echo "=== projectCreate ==="
PID=$(gq 'mutation { projectCreate(input: { name: "railpanel", description: "Mini panel ala Pterodactyl — file manager + terminal, tanpa docker", workspaceId: "d9928a8d-f685-4aef-996f-873a033b2b97" }) { id } }' | J "j.data.projectCreate.id")
echo "PROJECT_ID=$PID"
[ -n "$PID" ] || exit 1

echo "=== environments ==="
EID=$(gq "{ project(id: \"$PID\") { environments { id name } } }" | J "j.data.project.environments[0].id")
echo "ENV_ID=$EID"

echo "=== serviceCreate ==="
SID=$(gq "mutation { serviceCreate(input: { projectId: \"$PID\", name: \"railpanel\" }) { id } }" | J "j.data.serviceCreate.id")
echo "SERVICE_ID=$SID"

echo "=== volumeCreate (/data) ==="
gq "mutation { volumeCreate(input: { projectId: \"$PID\", environmentId: \"$EID\", serviceId: \"$SID\", mountPath: \"/data\" }) { id mountPath } }" | head -c 300; echo

echo "=== hasura summary ==="
echo "PROJECT_ID=$PID"
echo "ENV_ID=$EID"
echo "SERVICE_ID=$SID"
