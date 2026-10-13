import type { ErpArea } from './services/access';

/** The ERP home's area cards. A phase of plan 022 flips `live` when its screens ship. */
export interface AreaCard {
  area: ErpArea;
  name: string;
  href: string;
  description: string;
  live: boolean;
}

export const ERP_AREAS: AreaCard[] = [
  { area: 'stock', name: 'Stock', href: '/erp/stock', live: true, description: 'Items, warehouses, receipts, issues, transfers, stock counts and stock reports.' },
  { area: 'buying', name: 'Buying', href: '/erp/buying', live: false, description: 'Suppliers, material requests, supplier quotations, purchase orders, receipts and purchase invoices.' },
  { area: 'selling', name: 'Selling', href: '/erp/selling', live: false, description: 'Customers, sales orders, deliveries and sales invoices. Sales orders become PM projects.' },
  { area: 'manufacturing', name: 'Manufacturing', href: '/erp/manufacturing', live: false, description: 'BOMs, work orders, job cards and production planning.' },
  { area: 'quality', name: 'Quality', href: '/erp/quality', live: false, description: 'Inspections, non-conformances and controlled documents.' },
  { area: 'assets', name: 'Assets and maintenance', href: '/erp/assets', live: false, description: 'Asset register, depreciation, preventive maintenance and breakdowns.' },
  { area: 'accounts', name: 'Accounts', href: '/erp/accounts', live: false, description: 'Ledgers, invoices, payments, journals, bank reconciliation and financial reports.' },
];
