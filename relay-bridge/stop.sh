#!/bin/bash
echo "Stopping MiMo bridge servers..."
for PORT in 4004 4005 4006 4007; do
  PID=$(lsof -t -i:$PORT 2>/dev/null)
  if [ -n "$PID" ]; then
    kill $PID 2>/dev/null
    echo "  Stopped port $PORT (PID $PID)"
  fi
done
echo "All MiMo bridges stopped."
