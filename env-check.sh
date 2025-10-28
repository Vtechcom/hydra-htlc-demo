#!/bin/bash

# Check Docker
if ! command -v docker &> /dev/null; then
  echo "Docker is not installed. Please install Docker before running this script."
  exit 1
fi

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
  echo "Docker Compose is not installed. Please install Docker Compose before running this script."
  exit 1
fi

# Check Node.js version > 18
NODE_VERSION=$(node -v | grep -oE '[0-9]+' | head -1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Node.js version must be >= 18. Current version is $(node -v)."
  exit 1
fi

# Check pnpm
if ! command -v pnpm &> /dev/null; then
  echo "pnpm is not installed. Please install pnpm before running this script."
  exit 1
fi

