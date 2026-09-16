#!/bin/sh
set -e

echo "==> Running Prisma database migrations..."
if [ -f "node_modules/prisma/build/index.js" ]; then
  node node_modules/prisma/build/index.js migrate deploy
else
  echo "FATAL: prisma CLI not found in the image" >&2
  exit 1
fi

echo "==> Starting Engineering OS Next.js server..."
exec node server.js
