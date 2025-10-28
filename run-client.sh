#!/bin/bash

# Trap SIGINT (Ctrl+C) and SIGTERM to cleanup
trap cleanup INT TERM

cleanup() {
  echo ""
  echo "Stopping client..."
  if [ ! -z "$CLIENT_PID" ]; then
    kill -9 $CLIENT_PID 2>/dev/null
  fi
  exit 0
}

# Start client
echo "Starting client..."
cd ./client || exit
pnpm install
pnpm dev &
CLIENT_PID=$!

if [ $? -ne 0 ]; then
  echo "Failed to start client. Please check the client."
  exit 1
fi
echo "Client started successfully with PID: $CLIENT_PID"
echo "Press Ctrl+C to stop the client"

# Wait for the process to finish
wait $CLIENT_PID
