#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
INBOX_DIR="$DIR/inboxes"
ROLE=$1

if [ -n "$ROLE" ]; then
  FILE="$INBOX_DIR/mimo-${ROLE}.inbox.jsonl"
  if [ -f "$FILE" ]; then
    echo "=== mimo-${ROLE} ==="
    cat "$FILE"
  else
    echo "No messages for mimo-${ROLE}"
  fi
else
  FOUND=0
  for f in "$INBOX_DIR"/mimo-*.inbox.jsonl; do
    if [ -f "$f" ]; then
      ROLE_NAME=$(basename "$f" .inbox.jsonl)
      echo "=== $ROLE_NAME ==="
      cat "$f"
      echo ""
      FOUND=1
    fi
  done
  if [ "$FOUND" -eq 0 ]; then
    echo "No messages in any inbox"
  fi
fi
