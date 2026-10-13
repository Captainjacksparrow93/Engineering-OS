import { prisma } from '@/core/db/prisma';
import { NotFoundError } from '@/core/rbac/errors';
import { readArea } from './access';
import { companyBlock, itemsFor, registerPrint } from './print.service';

/** Printable sales order, delivery note (no prices) and tax invoice. */
const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

registerPrint('sales-order', async (p, id) => {
  await readArea(p, 'selling');
  const so = await prisma.erpSalesOrder.findFirst({ where: { id, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  if (!so) throw new NotFoundError('Sales order not found.');
  const [company, customer, items] = await Promise.all([companyBlock(p.companyId), prisma.erpParty.findUnique({ where: { id: so.customerId } }), itemsFor(so.lines.map((l) => l.itemId))]);
  return {
    title: 'Order Acknowledgement',
    number: so.number,
    status: so.status,
    company,
    partyLabel: 'Customer',
    party: customer,
    meta: [['Order date', day(so.orderDate)], ['Delivery', day(so.deliveryDate)], ...(so.poNo ? [['Your PO', so.poNo] as [string, string]] : []), ...(so.woNumber ? [['WO', so.woNumber] as [string, string]] : [])],
    lines: so.lines.map((l) => {
      const item = items.get(l.itemId);
      return { description: l.description ?? `${item?.code} ${item?.name}`, hsn: item?.hsnCode ?? null, qty: l.qty, uom: item?.uom ?? 'Nos', rate: l.rate, amount: l.amount, gstRate: l.gstRate };
    }),
    totals: so,
    terms: so.terms,
  };
});

registerPrint('delivery-note', async (p, id) => {
  await readArea(p, 'selling').catch(() => readArea(p, 'stock'));
  const dn = await prisma.erpDeliveryNote.findFirst({ where: { id, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  if (!dn) throw new NotFoundError('Delivery note not found.');
  const [company, customer, items] = await Promise.all([companyBlock(p.companyId), prisma.erpParty.findUnique({ where: { id: dn.customerId } }), itemsFor(dn.lines.map((l) => l.itemId))]);
  return {
    title: 'Delivery Challan',
    number: dn.number,
    status: dn.status,
    company,
    partyLabel: 'Deliver to',
    party: customer,
    meta: [['Date', day(dn.postingDate)], ...(dn.transporter ? [['Transporter', dn.transporter] as [string, string]] : []), ...(dn.vehicleNo ? [['Vehicle', dn.vehicleNo] as [string, string]] : []), ...(dn.lrNo ? [['LR no.', dn.lrNo] as [string, string]] : [])],
    lines: dn.lines.map((l) => {
      const item = items.get(l.itemId);
      return { description: `${item?.code} ${item?.name}`, hsn: item?.hsnCode ?? null, qty: l.qty, uom: item?.uom ?? 'Nos', rate: null, amount: null, gstRate: null };
    }),
    totals: null,
    terms: dn.remarks,
  };
});

registerPrint('sales-invoice', async (p, id) => {
  await readArea(p, 'selling').catch(() => readArea(p, 'accounts'));
  const inv = await prisma.erpSalesInvoice.findFirst({ where: { id, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  if (!inv) throw new NotFoundError('Sales invoice not found.');
  const [company, customer, items, settings] = await Promise.all([
    companyBlock(p.companyId),
    prisma.erpParty.findUnique({ where: { id: inv.customerId } }),
    itemsFor(inv.lines.map((l) => l.itemId).filter((x): x is string => !!x)),
    prisma.erpSettings.findUnique({ where: { companyId: p.companyId } }),
  ]);
  return {
    title: inv.isReturn ? 'Credit Note' : 'Tax Invoice',
    number: inv.number,
    status: inv.status,
    company,
    partyLabel: 'Bill to',
    party: customer,
    meta: [['Invoice date', day(inv.postingDate)], ['Due date', day(inv.dueDate)], ...(inv.poNo ? [['Your PO', inv.poNo] as [string, string]] : []), ...(customer?.state ? [['Place of supply', customer.state] as [string, string]] : [])],
    lines: inv.lines.map((l) => {
      const item = l.itemId ? items.get(l.itemId) : undefined;
      return { description: l.description, hsn: item?.hsnCode ?? null, qty: l.qty, uom: item?.uom ?? 'Nos', rate: l.rate, amount: l.amount, gstRate: l.gstRate };
    }),
    totals: inv,
    terms: settings?.salesTerms || null,
  };
});
