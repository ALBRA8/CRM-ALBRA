#!/bin/bash
# CRM ALBRA - Persistent dev server start script (portable)
cd "$(dirname "$0")/.."

# Kill any existing instances
pkill -f "next-server" 2>/dev/null
pkill -f "next dev" 2>/dev/null
pkill -f "whatsapp-daemon" 2>/dev/null
sleep 2

# Start fresh dev server using setsid for full detachment
setsid -f bash -c 'npm run dev > dev.log 2>&1' > /dev/null 2>&1

# Wait for server to be ready
for i in {1..30}; do
  if curl -sS -o /dev/null http://localhost:3000/ 2>/dev/null; then
    echo "Server up after ${i}s"
    break
  fi
  sleep 1
done

# Show status
ps aux | grep -E "next-server|whatsapp-daemon" | grep -v grep | head -3
echo "---"
tail -5 dev.log
