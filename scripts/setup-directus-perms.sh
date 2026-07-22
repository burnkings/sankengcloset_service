#!/bin/bash
# Grant Directus permissions for admin role
set -e

DT=$(curl -s -X POST http://127.0.0.1:8055/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@sankengcloset.icu","password":"d8Q_JVPrjBHvDiY2WGmKvv8s"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['access_token'])")

ROLE_ID=$(curl -s -H "Authorization: Bearer $DT" "http://127.0.0.1:8055/roles" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print([r['id'] for r in d.get('data',[]) if r.get('admin_access')][0])")

echo "Admin role: $ROLE_ID"

for COLL in products source_records crawl_jobs price_snapshots brands product_images product_variants tags product_tags; do
  RESULT=$(curl -s -X POST -H "Authorization: Bearer $DT" -H "Content-Type: application/json" \
    "http://127.0.0.1:8055/permissions" \
    -d "{\"role\":\"$ROLE_ID\",\"collection\":\"$COLL\",\"permissions\":{\"_and\":[]},\"presets\":null,\"fields\":[\"*\"],\"action\":\"read\"}")
  STATUS=$(echo "$RESULT" | python3 -c "import json,sys;d=json.load(sys.stdin);print('OK' if d.get('data') else 'FAIL: '+str(d.get('errors',[{}])[0].get('message','')))" 2>/dev/null || echo "PARSE_ERROR")
  echo "  $COLL: $STATUS"
done

echo ""
echo "=== Verification ==="
for COLL in products source_records crawl_jobs price_snapshots brands; do
  COUNT=$(curl -s -H "Authorization: Bearer $DT" "http://127.0.0.1:8055/items/$COLL?limit=0" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('meta',{}).get('total_count','?'))" 2>/dev/null || echo "?")
  echo "  $COLL: $COUNT rows"
done
