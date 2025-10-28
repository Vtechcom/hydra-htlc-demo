#!/bin/bash

# Trap SIGINT (Ctrl+C) and SIGTERM to cleanup
trap cleanup INT TERM

cleanup() {
  echo ""
  echo "Stopping server..."
  if [ ! -z "$SERVER_PID" ]; then
    kill -9 $SERVER_PID 2>/dev/null
  fi
  exit 0
}

# Read startup_time.txt and write to .env files
echo "Reading startup_time.txt..."
cd ./infra || exit
if [ -f "./startup_time.txt" ]; then
  HYDRA_HEAD_START_TIME=$(cat ./startup_time.txt)
  echo "Hydra Head Start Time: $HYDRA_HEAD_START_TIME"
  
  # Update client .env
  cd ../client
  if [ ! -f ".env" ]; then
    touch .env
  fi
  
  # Remove old HYDRA_HEAD_START_TIME entry if exists
  sed -i.bak '/^HYDRA_HEAD_START_TIME=/d' .env && rm -f .env.bak
  
  # Add new HYDRA_HEAD_START_TIME
  echo "HYDRA_HEAD_START_TIME=$HYDRA_HEAD_START_TIME" >> .env
  echo "Updated client/.env with HYDRA_HEAD_START_TIME"
  
  # Update server .env
  cd ../server
  if [ ! -f ".env" ]; then
    touch .env
  fi
  
  # Remove old HYDRA_HEAD_START_TIME entry if exists
  sed -i.bak '/^HYDRA_HEAD_START_TIME=/d' .env && rm -f .env.bak
  
  # Add new HYDRA_HEAD_START_TIME
  echo "HYDRA_HEAD_START_TIME=$HYDRA_HEAD_START_TIME" >> .env
  echo "Updated server/.env with HYDRA_HEAD_START_TIME"
  
  cd ..
else
  echo "Warning: startup_time.txt not found in infra directory."
fi

# Start backend Node.js
echo "Starting backend..."
cd ./server || exit

# Read PORT from .env file
PORT=3068  # Default port
if [ -f ".env" ]; then
  ENV_PORT=$(grep "^PORT=" .env | cut -d '=' -f2)
  if [ ! -z "$ENV_PORT" ]; then
    PORT=$ENV_PORT
  fi
fi

echo "Checking port $PORT..."

# Check if port is already in use
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
  echo "Error: Port $PORT is already in use."
  echo "Please stop the process running on port $PORT or use a different port."
  lsof -i :$PORT
  exit 1
fi

pnpm install
pnpm start:dev &
SERVER_PID=$!

if [ $? -ne 0 ]; then
  echo "Failed to start backend. Please check the server."
  exit 1
fi
echo "Backend started successfully with PID: $SERVER_PID"
echo "Press Ctrl+C to stop the server"

# Wait for the process to finish
wait $SERVER_PID

