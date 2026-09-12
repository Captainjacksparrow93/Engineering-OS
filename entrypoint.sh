#!/bin/sh
set -e

echo "==> Running Prisma database migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "==> Starting Engineering OS Next.js server..."
exec node server.js
