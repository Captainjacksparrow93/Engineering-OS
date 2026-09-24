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
  node node_modules/tsx/dist/cli.mjs prisma/seed.ts || echo "ERROR: Main seed failed — see exception above" >&2
  node node_modules/tsx/dist/cli.mjs prisma/seed-demo.ts || echo "ERROR: Demo seed failed — see exception above" >&2
  node node_modules/tsx/dist/cli.mjs prisma/scripts/set-passwords-from-csv.ts || echo "ERROR: Password sync failed — see exception above" >&2
  node node_modules/tsx/dist/cli.mjs prisma/scripts/grant-commissioning-permissions.ts || echo "ERROR: Commissioning permission sync failed — see exception above" >&2
elif command -v npx >/dev/null 2>&1; then
  npx prisma db seed || echo "ERROR: Main seed failed — see exception above" >&2
  npx tsx prisma/seed-demo.ts || echo "ERROR: Demo seed failed — see exception above" >&2
  npx tsx prisma/scripts/set-passwords-from-csv.ts || echo "ERROR: Password sync failed — see exception above" >&2
  npx tsx prisma/scripts/grant-commissioning-permissions.ts || echo "ERROR: Commissioning permission sync failed — see exception above" >&2
fi

echo "==> Starting Engineering OS Next.js server..."
exec node server.js
