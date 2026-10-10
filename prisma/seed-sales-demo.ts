/**
 * LOCAL DEMO DATA ONLY for the Sales module (plan 018). Never run against production and never
 * add to entrypoint.sh. Adds a small priced catalogue, three clients with contacts and a year of
 * past quotes, so the quote builder's advice has something to show. Safe to run twice: it skips
 * when the demo catalogue already exists.
 *
 *   npm run db:seed:sales-demo
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ITEMS: Array<[code: string, name: string, make: string, category: string, purchase: number, list: number]> = [
  ['6ES7214-1AG40', 'S7-1200 CPU 1214C DC/DC/DC', 'Siemens', 'PLC', 28500, 41000],
  ['6ES7221-1BH32', 'SM 1221 DI 16x24V DC', 'Siemens', 'PLC', 9800, 14200],
  ['6ES7222-1BH32', 'SM 1222 DQ 16x24V DC', 'Siemens', 'PLC', 10400, 15000],
  ['6ES7231-4HD32', 'SM 1231 AI 4x13 bit', 'Siemens', 'PLC', 17600, 25500],
  ['6AV2123-2GB03', 'KTP700 Basic HMI 7"', 'Siemens', 'HMI', 41000, 59000],
  ['6EP1333-2BA20', 'SITOP PSU 24V 5A', 'Siemens', 'Power supply', 7200, 10300],
  ['3RT2026-1AP00', 'Contactor 25A 230V AC', 'Siemens', 'Switchgear', 2900, 4100],
  ['3RV2021-4AA10', 'Motor protection breaker 11–16A', 'Siemens', 'Switchgear', 4600, 6600],
  ['5SL6332-7', 'MCB 3P C32', 'Siemens', 'Switchgear', 1150, 1650],
  ['6SL3210-1KE21-3UF1', 'SINAMICS G120C VFD 5.5kW', 'Siemens', 'Drives', 52000, 74000],
  ['ENC-800x2000', 'Panel enclosure 800×2000×600 IP54', 'Rittal', 'Enclosure', 48000, 61000],
  ['WIRING-STD', 'Wiring, ferrules and accessories (per panel)', 'ACS', 'Labour', 18000, 18000],
];

const CLIENTS = [
  { name: 'Torrent Pharmaceuticals', city: 'Ahmedabad', industry: 'Pharma', strategic: true, paymentDelayDays: 12, contact: ['Rakesh Shah', 'Purchase Manager', 'rakesh.shah@example.test'] },
  { name: 'Gujarat Water Works', city: 'Vadodara', industry: 'Water', strategic: false, paymentDelayDays: 75, contact: ['Meera Joshi', 'Project Engineer', 'meera.joshi@example.test'] },
  { name: 'Shree Cement Udyog', city: 'Rajkot', industry: 'Cement', strategic: false, paymentDelayDays: 20, contact: ['Anil Patel', 'Electrical Head', 'anil.patel@example.test'] },
];

// Typical BOMs: [item code, qty]
const PLC_BOM: Array<[string, number]> = [['6ES7214-1AG40', 1], ['6ES7221-1BH32', 2], ['6ES7222-1BH32', 1], ['6EP1333-2BA20', 1], ['5SL6332-7', 2], ['ENC-800x2000', 1], ['WIRING-STD', 1]];
const VFD_BOM: Array<[string, number]> = [['6SL3210-1KE21-3UF1', 2], ['3RV2021-4AA10', 2], ['3RT2026-1AP00', 2], ['5SL6332-7', 1], ['ENC-800x2000', 1], ['WIRING-STD', 1]];

async function main() {
  const company = await prisma.company.findFirstOrThrow({ where: { code: 'ACS' } });
  if (await prisma.salesItem.findFirst({ where: { companyId: company.id, code: '6ES7214-1AG40' } })) {
    console.log('Sales demo data already present. Nothing to do.');
    return;
  }
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);

  const cost = new Map<string, number>();
  for (const [code, name, make, category, purchase, list] of ITEMS) {
    cost.set(code, purchase);
    await prisma.salesItem.create({
      data: {
        companyId: company.id,
        code,
        name,
        make,
        category,
        uom: code === 'WIRING-STD' ? 'Set' : 'Nos',
        prices: {
          create: [
            { source: 'PRICE_LIST', rate: Math.round(list * 0.72), listPrice: list, discountPct: 28, reference: 'Price list 2026', effectiveDate: daysAgo(150) },
            // One item has only an old purchase price, to show the "old price" flag.
            { source: 'PURCHASE', rate: purchase, supplier: 'Siemens distributor', reference: `PO-${code.slice(0, 6)}`, effectiveDate: daysAgo(code === '6AV2123-2GB03' ? 240 : 30) },
          ],
        },
      },
    });
  }

  for (const [i, c] of CLIENTS.entries()) {
    const account = await prisma.salesAccount.create({
      data: {
        companyId: company.id,
        name: c.name,
        city: c.city,
        industry: c.industry,
        strategic: c.strategic,
        paymentDelayDays: c.paymentDelayDays,
        contacts: { create: { name: c.contact[0]!, designation: c.contact[1], email: c.contact[2] } },
      },
    });
    // Eight past quotes per client over 18 months; margins and outcomes vary by client.
    for (let q = 0; q < 8; q++) {
      const margin = [18, 22, 15, 26, 20, 17, 24, 19][(q + i) % 8]! - i * 2;
      const won = margin <= 21 - i;
      const bom = q % 3 === 2 ? VFD_BOM : PLC_BOM;
      const ref = `HIST-${i + 1}${String(q + 1).padStart(2, '0')}`;
      await prisma.salesHistoryLine.createMany({
        data: bom.map(([code, qty]) => ({
          companyId: company.id,
          source: 'IMPORT' as const,
          batchId: 'sales-demo',
          ref,
          date: daysAgo(540 - q * 60 - i * 7),
          accountId: account.id,
          accountName: account.name,
          outcome: won ? ('WON' as const) : ('LOST' as const),
          itemCode: code,
          description: ITEMS.find((it) => it[0] === code)![1],
          qty,
          unitCost: cost.get(code)!,
          unitPrice: Math.round(cost.get(code)! / (1 - margin / 100)),
        })),
      });
    }
  }
  console.log(`Sales demo: ${ITEMS.length} items, ${CLIENTS.length} clients, ${CLIENTS.length * 8} past quotes.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
