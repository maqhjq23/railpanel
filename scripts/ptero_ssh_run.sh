#!/usr/bin/env bash
# usage: ptero_ssh_run.sh <local-script.sh>  — kirim + jalankan script di container panel via railway ssh
set -e
PROJ=d32512be-ed71-49f1-b8b6-610953e070e8
ENVI=6ee6d296-44bb-4d2b-a796-126f6dad7497
SVC=785bdc10-f22e-498e-a4eb-bead44552a91
F="$1"
B64=$(base64 -w0 "$F")
railway ssh --project="$PROJ" --environment="$ENVI" --service="$SVC" -- "echo $B64 | base64 -d > /tmp/.ptero_run.sh && sh /tmp/.ptero_run.sh"
