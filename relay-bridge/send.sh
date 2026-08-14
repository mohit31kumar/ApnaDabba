#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET=$1
MESSAGE=$2

if [ -z "$TARGET" ] || [ -z "$MESSAGE" ]; then
  echo "Usage: $0 <target> <message>"
  echo "Targets: tech-lead, architect, backend, frontend"
  exit 1
fi

case $TARGET in
  tech-lead) PORT=4000 ;;
  architect) PORT=4001 ;;
  backend)   PORT=4002 ;;
  frontend)  PORT=4003 ;;
  *) echo "Unknown target: $TARGET"; exit 1 ;;
esac

SESSION_ID=$(curl -s "http://127.0.0.1:${PORT}/session?limit=10" | \
  python3 -c "import sys,json; sessions=json.load(sys.stdin); print(next((s['id'] for s in sessions if s.get('title','').lower()=='$TARGET' and not s.get('parentID')), ''))" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  echo "Could not find session for $TARGET on port $PORT"
  exit 1
fi

curl -s -X POST "http://127.0.0.1:${PORT}/session/${SESSION_ID}/prompt_async" \
  -H "Content-Type: application/json" \
  -d "{\"parts\":[{\"type\":\"text\",\"text\":\"[Chat from mimo]: ${MESSAGE}\"}]}"

echo ""
echo "Message sent to $TARGET (port $PORT)"
