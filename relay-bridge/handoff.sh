#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
INBOX_DIR="$DIR/inboxes"

echo "=== OpenCode Instance Health ==="
for pair in "tech-lead:4000" "architect:4001" "backend:4002" "frontend:4003"; do
  NAME="${pair%%:*}"
  PORT="${pair##*:}"
  STATUS=$(curl -s --max-time 2 "http://127.0.0.1:${PORT}/global/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ONLINE' if d.get('healthy') else 'OFFLINE')" 2>/dev/null || echo "OFFLINE")
  echo "  $NAME (port $PORT): $STATUS"
done

echo ""
echo "=== MiMo Bridge Health ==="
for pair in "tech-lead:4004" "architect:4005" "backend:4006" "frontend:4007"; do
  NAME="${pair%%:*}"
  PORT="${pair##*:}"
  STATUS=$(curl -s --max-time 2 "http://127.0.0.1:${PORT}/global/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ONLINE' if d.get('healthy') else 'OFFLINE')" 2>/dev/null || echo "OFFLINE")
  echo "  $NAME (port $PORT): $STATUS"
done

echo ""
echo "=== Pending Messages ==="
FOUND=0
for f in "$INBOX_DIR"/mimo-*.inbox.jsonl; do
  if [ -f "$f" ]; then
    ROLE_NAME=$(basename "$f" .inbox.jsonl)
    COUNT=$(wc -l < "$f")
    echo "  $ROLE_NAME: $COUNT messages"
    FOUND=1
  fi
done
if [ "$FOUND" -eq 0 ]; then
  echo "  No pending messages"
fi

echo ""
echo "Handoff ready. MiMo Code can now process pending work."
