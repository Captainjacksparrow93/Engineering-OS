import type { ErpRootType } from '@prisma/client';

/**
 * The standard chart of accounts a new company starts with (Indian, ERPNext "Standard"
 * template, trimmed to what a panel builder uses). `key` marks the accounts the posting
 * engine relies on; they can be renamed but never deleted.
 */
export interface ChartRow {
  code: string;
  name: string;
  parent?: string;
  group?: boolean;
  key?: SystemAccount;
  type?: 'BANK' | 'CASH' | 'RECEIVABLE' | 'PAYABLE' | 'STOCK' | 'TAX' | 'FIXED_ASSET' | 'DEPRECIATION';
}

export type SystemAccount =
  | 'CASH'
  | 'BANK'
  | 'DEBTORS'
  | 'CREDITORS'
  | 'STOCK_IN_HAND'
  | 'SRBNB'
  | 'INPUT_CGST'
  | 'INPUT_SGST'
  | 'INPUT_IGST'
  | 'OUTPUT_CGST'
  | 'OUTPUT_SGST'
  | 'OUTPUT_IGST'
  | 'TDS_PAYABLE'
  | 'FIXED_ASSETS'
  | 'ACCUMULATED_DEPRECIATION'
  | 'OPENING'
  | 'RETAINED_EARNINGS'
  | 'SALES'
  | 'SERVICE_INCOME'
  | 'OTHER_INCOME'
  | 'COGS'
  | 'MATERIALS_CONSUMED'
  | 'STOCK_ADJUSTMENT'
  | 'EXPENSES_IN_VALUATION'
  | 'PURCHASE_EXPENSES'
  | 'DEPRECIATION'
  | 'REPAIRS'
  | 'ROUND_OFF'
  | 'WRITE_OFF'
  | 'ASSET_DISPOSAL';

export const ROOTS: Array<{ code: string; name: string; rootType: ErpRootType }> = [
  { code: '1000', name: 'Assets', rootType: 'ASSET' },
  { code: '2000', name: 'Liabilities', rootType: 'LIABILITY' },
  { code: '3000', name: 'Equity', rootType: 'EQUITY' },
  { code: '4000', name: 'Income', rootType: 'INCOME' },
  { code: '5000', name: 'Expenses', rootType: 'EXPENSE' },
];

export const STANDARD_CHART: ChartRow[] = [
  { code: '1100', name: 'Current Assets', parent: '1000', group: true },
  { code: '1110', name: 'Cash', parent: '1100', key: 'CASH', type: 'CASH' },
  { code: '1120', name: 'Bank Accounts', parent: '1100', group: true },
  { code: '1121', name: 'Bank', parent: '1120', key: 'BANK', type: 'BANK' },
  { code: '1130', name: 'Debtors', parent: '1100', key: 'DEBTORS', type: 'RECEIVABLE' },
  { code: '1140', name: 'Stock Assets', parent: '1100', group: true },
  { code: '1141', name: 'Stock In Hand', parent: '1140', key: 'STOCK_IN_HAND', type: 'STOCK' },
  { code: '1150', name: 'Tax Assets', parent: '1100', group: true },
  { code: '1151', name: 'Input CGST', parent: '1150', key: 'INPUT_CGST', type: 'TAX' },
  { code: '1152', name: 'Input SGST', parent: '1150', key: 'INPUT_SGST', type: 'TAX' },
  { code: '1153', name: 'Input IGST', parent: '1150', key: 'INPUT_IGST', type: 'TAX' },
  { code: '1160', name: 'Loans and Advances', parent: '1100', group: true },
  { code: '1161', name: 'Employee Advances', parent: '1160' },
  { code: '1162', name: 'Security Deposits', parent: '1160' },
  { code: '1200', name: 'Fixed Assets', parent: '1000', group: true },
  { code: '1210', name: 'Plant and Machinery', parent: '1200', key: 'FIXED_ASSETS', type: 'FIXED_ASSET' },
  { code: '1220', name: 'Furniture and Fixtures', parent: '1200', type: 'FIXED_ASSET' },
  { code: '1230', name: 'Office Equipment', parent: '1200', type: 'FIXED_ASSET' },
  { code: '1240', name: 'Computers', parent: '1200', type: 'FIXED_ASSET' },
  { code: '1250', name: 'Vehicles', parent: '1200', type: 'FIXED_ASSET' },
  { code: '1260', name: 'Buildings', parent: '1200', type: 'FIXED_ASSET' },
  { code: '1270', name: 'Tools and Test Equipment', parent: '1200', type: 'FIXED_ASSET' },
  { code: '1290', name: 'Accumulated Depreciation', parent: '1200', key: 'ACCUMULATED_DEPRECIATION', type: 'DEPRECIATION' },

  { code: '2100', name: 'Current Liabilities', parent: '2000', group: true },
  { code: '2110', name: 'Creditors', parent: '2100', key: 'CREDITORS', type: 'PAYABLE' },
  { code: '2120', name: 'Stock Received But Not Billed', parent: '2100', key: 'SRBNB' },
  { code: '2130', name: 'Duties and Taxes', parent: '2100', group: true },
  { code: '2131', name: 'Output CGST', parent: '2130', key: 'OUTPUT_CGST', type: 'TAX' },
  { code: '2132', name: 'Output SGST', parent: '2130', key: 'OUTPUT_SGST', type: 'TAX' },
  { code: '2133', name: 'Output IGST', parent: '2130', key: 'OUTPUT_IGST', type: 'TAX' },
  { code: '2134', name: 'TDS Payable', parent: '2130', key: 'TDS_PAYABLE', type: 'TAX' },
  { code: '2140', name: 'Salaries Payable', parent: '2100' },
  { code: '2200', name: 'Loans (Liabilities)', parent: '2000', group: true },
  { code: '2210', name: 'Secured Loans', parent: '2200' },
  { code: '2220', name: 'Unsecured Loans', parent: '2200' },

  { code: '3100', name: 'Capital Stock', parent: '3000' },
  { code: '3200', name: 'Retained Earnings', parent: '3000', key: 'RETAINED_EARNINGS' },
  { code: '3300', name: 'Opening Balance Equity', parent: '3000', key: 'OPENING' },

  { code: '4100', name: 'Direct Income', parent: '4000', group: true },
  { code: '4110', name: 'Sales', parent: '4100', key: 'SALES' },
  { code: '4120', name: 'Service Income', parent: '4100', key: 'SERVICE_INCOME' },
  { code: '4200', name: 'Indirect Income', parent: '4000', group: true },
  { code: '4210', name: 'Other Income', parent: '4200', key: 'OTHER_INCOME' },
  { code: '4220', name: 'Interest Income', parent: '4200' },

  { code: '5100', name: 'Direct Expenses', parent: '5000', group: true },
  { code: '5110', name: 'Cost of Goods Sold', parent: '5100', key: 'COGS' },
  { code: '5115', name: 'Materials Consumed', parent: '5100', key: 'MATERIALS_CONSUMED' },
  { code: '5120', name: 'Stock Adjustment', parent: '5100', key: 'STOCK_ADJUSTMENT' },
  { code: '5130', name: 'Expenses Included In Valuation', parent: '5100', key: 'EXPENSES_IN_VALUATION' },
  { code: '5140', name: 'Freight and Forwarding', parent: '5100' },
  { code: '5150', name: 'Purchase Expenses', parent: '5100', key: 'PURCHASE_EXPENSES' },
  { code: '5160', name: 'Subcontracting Charges', parent: '5100' },
  { code: '5200', name: 'Indirect Expenses', parent: '5000', group: true },
  { code: '5210', name: 'Salaries and Wages', parent: '5200' },
  { code: '5220', name: 'Rent', parent: '5200' },
  { code: '5230', name: 'Electricity', parent: '5200' },
  { code: '5240', name: 'Telephone and Internet', parent: '5200' },
  { code: '5250', name: 'Travel and Conveyance', parent: '5200' },
  { code: '5260', name: 'Office Expenses', parent: '5200' },
  { code: '5270', name: 'Repairs and Maintenance', parent: '5200', key: 'REPAIRS' },
  { code: '5280', name: 'Depreciation', parent: '5200', key: 'DEPRECIATION' },
  { code: '5290', name: 'Bank Charges', parent: '5200' },
  { code: '5291', name: 'Professional Fees', parent: '5200' },
  { code: '5292', name: 'Round Off', parent: '5200', key: 'ROUND_OFF' },
  { code: '5293', name: 'Write Off', parent: '5200', key: 'WRITE_OFF' },
  { code: '5295', name: 'Gain/Loss on Asset Disposal', parent: '5200', key: 'ASSET_DISPOSAL' },
  { code: '5294', name: 'Miscellaneous Expenses', parent: '5200' },
];

/** Default warehouses (ERPNext: Stores, Work In Progress, Finished Goods, plus Rejected). */
export const STANDARD_WAREHOUSES: Array<{ key: string; name: string }> = [
  { key: 'STORES', name: 'Stores' },
  { key: 'WIP', name: 'Work In Progress' },
  { key: 'FINISHED_GOODS', name: 'Finished Goods' },
  { key: 'REJECTED', name: 'Rejected' },
];

/** Apr–Mar fiscal year label for a date, e.g. 2026-27. */
export function fiscalYear(date: Date): { label: string; start: Date; end: Date } {
  const y = date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return {
    label: `${y}-${String((y + 1) % 100).padStart(2, '0')}`,
    start: new Date(Date.UTC(y, 3, 1)),
    end: new Date(Date.UTC(y + 1, 2, 31)),
  };
}
