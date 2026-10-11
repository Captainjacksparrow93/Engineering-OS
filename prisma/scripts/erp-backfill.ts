/**
 * Plan 015: backfill existing clients and work-order projects into ERPNext.
 * One-off, run by hand. Never from entrypoint.sh.
 *
 *   npx tsx prisma/scripts/erp-backfill.ts            # dry run: prints what it would do
 *   npx tsx prisma/scripts/erp-backfill.ts --apply    # writes to ERPNext and our DB
 *   ... --company=ACS                                 # company code (default ACS)
 *
 * ERPNext settings come from the environment only: ERPNEXT_URL, ERPNEXT_API_KEY,
 * ERPNEXT_API_SECRET, plus APP_URL for the project links written onto the orders.
 */
import { prisma } from '../../src/core/db/prisma';
import { isErpEnabled } from '../../src/modules/erp/client';
import { runBackfill } from '../../src/modules/erp/backfill';

async function main() {
  const apply = process.argv.includes('--apply');
  const code = process.argv.find((a) => a.startsWith('--company='))?.split('=')[1] ?? 'ACS';
  if (!isErpEnabled()) throw new Error('Set ERPNEXT_URL, ERPNEXT_API_KEY and ERPNEXT_API_SECRET first.');
  const company = await prisma.company.findUnique({ where: { code } });
  if (!company) throw new Error(`No company with code ${code}.`);

  console.log(`ERP backfill for ${company.name}: ${apply ? 'APPLY (writes)' : 'dry run (no writes; add --apply to write)'}`);
  const report = await runBackfill({ companyId: company.id, apply });
  if (report.clients.failed + report.projects.failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
