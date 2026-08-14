#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting MiMo bridge servers..."

PORT=4004 ROLE=tech-lead nohup node "$DIR/server.js" > /dev/null 2>&1 &
PORT=4005 ROLE=architect nohup node "$DIR/server.js" > /dev/null 2>&1 &
PORT=4006 ROLE=backend nohup node "$DIR/server.js" > /dev/null 2>&1 &
PORT=4007 ROLE=frontend nohup node "$DIR/server.js" > /dev/null 2>&1 &

sleep 1

echo "All MiMo bridges started:"
for pair in "tech-lead:4004" "architect:4005" "backend:4006" "frontend:4007"; do
  NAME="${pair%%:*}"
  PORT="${pair##*:}"
  STATUS=$(curl -s --max-time 2 "http://127.0.0.1:${PORT}/global/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ONLINE' if d.get('healthy') else 'OFFLINE')" 2>/dev/null || echo "OFFLINE")
  echo "  $NAME (port $PORT): $STATUS"
done
