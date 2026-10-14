/**
 * Plan 022 phase 8: give every existing work-order project an imported, submitted ERP sales
 * order (plan 015 rule, native). One-off, run by hand after a backup. Never from entrypoint.sh.
 *
 *   npx tsx prisma/scripts/erp-backfill-orders.ts                       # dry run: prints what it would do
 *   npx tsx prisma/scripts/erp-backfill-orders.ts --apply --actor=EMAIL # writes, recorded as that user
 *   ... --company=ACS                                                   # company code (default ACS)
 */
import { prisma } from '../../src/core/db/prisma';
import { runBackfill } from '../../src/modules/erp/backfill';

async function main() {
  const apply = process.argv.includes('--apply');
  const code = process.argv.find((a) => a.startsWith('--company='))?.split('=')[1] ?? 'ACS';
  const actorEmail = process.argv.find((a) => a.startsWith('--actor='))?.split('=')[1];
  const company = await prisma.company.findUnique({ where: { code } });
  if (!company) throw new Error(`No company with code ${code}.`);
  const actor = actorEmail ? await prisma.user.findFirst({ where: { companyId: company.id, email: actorEmail.toLowerCase() } }) : null;
  if (apply && !actor) throw new Error('With --apply, pass --actor=<email of the Director running it>.');

  console.log(`ERP order backfill for ${company.name}: ${apply ? 'APPLY (writes)' : 'dry run (no writes; add --apply to write)'}`);
  const report = await runBackfill({ companyId: company.id, actorId: actor?.id ?? '', apply });
  if (report.failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
