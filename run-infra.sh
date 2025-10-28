#!/bin/bash

# Start infra
echo "Starting infra..."
cd ./infra || exit
docker-compose up 
if [ $? -ne 0 ]; then
  echo "Failed to start infra. Please check Docker Compose."
  exit 1
fi
echo "Infra started successfully."


