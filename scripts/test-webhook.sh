#!/usr/bin/env bash
set -euo pipefail

: "${META_APP_SECRET:?Set META_APP_SECRET in env before running}"

BODY='{"entry":[{"changes":[{"value":{"messages":[{"id":"ABCD123","from":"50760000000","type":"text","text":{"body":"Hola Uno"}}]}}]}]}'
SIG=$(printf "%s" "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" -hex | awk '{print $2}')

curl -i -X POST http://localhost:3000/api/webhooks/whatsapp \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -H "Content-Type: application/json" \
  --data "$BODY"
