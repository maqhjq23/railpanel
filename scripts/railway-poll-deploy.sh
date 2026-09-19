#!/usr/bin/env bash
# Poll status deployment terakhir service railpanel
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.railway/config.json','utf8')).user.token)")
EP="https://backboard.railway.com/graphql/v2"
Q='query { project(id: "d32512be-ed71-49f1-b8b6-610953e070e8") { deployments(last: 3) { edges { node { id status createdAt staticUrl } } } } }'
curl -s "$EP" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"query\": $(node -e "console.log(JSON.stringify(process.argv[1]))" "$Q")}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);(j.data?.project?.deployments?.edges||[]).forEach(e=>console.log(new Date(e.node.createdAt).toISOString(),'|',e.node.status,'|',e.node.staticUrl||'-'))})"
