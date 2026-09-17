#!/bin/sh
set -e

echo "==> Synchronizing Prisma database schema..."
if [ -f "node_modules/prisma/build/index.js" ]; then
  node node_modules/prisma/build/index.js db push --skip-generate
else
  echo "FATAL: prisma CLI not found in the image" >&2
  exit 1
fi

echo "==> Synchronizing system roles, permissions and seed data..."
if [ -f "node_modules/tsx/dist/cli.mjs" ]; then
  node node_modules/tsx/dist/cli.mjs prisma/seed.ts || echo "Notice: Seed check completed."
  node node_modules/tsx/dist/cli.mjs prisma/seed-demo.ts || echo "Notice: Demo seed check completed."
  node node_modules/tsx/dist/cli.mjs prisma/scripts/set-passwords-from-csv.ts || echo "Notice: Password sync failed."
elif command -v npx >/dev/null 2>&1; then
  npx prisma db seed || echo "Notice: Seed check completed."
  npx tsx prisma/seed-demo.ts || echo "Notice: Demo seed check completed."
  npx tsx prisma/scripts/set-passwords-from-csv.ts || echo "Notice: Password sync failed."
fi

echo "==> Starting Engineering OS Next.js server..."
exec node server.js
