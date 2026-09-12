#!/bin/sh
set -e

echo "==> Running Prisma database migrations..."
if [ -f "node_modules/prisma/build/index.js" ]; then
  node node_modules/prisma/build/index.js migrate deploy || true
fi

echo "==> Starting Engineering OS Next.js server..."
exec node server.js
