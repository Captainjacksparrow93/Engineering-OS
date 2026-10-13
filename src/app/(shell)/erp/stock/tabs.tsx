import { AreaTabs } from '../_components/parts';

export function StockTabs({ current }: { current: string }) {
  return (
    <AreaTabs
      current={current}
      tabs={[
        { href: '/erp/stock', label: 'Overview' },
        { href: '/erp/stock/items', label: 'Items' },
        { href: '/erp/stock/entries', label: 'Stock entries' },
        { href: '/erp/stock/reconciliations', label: 'Stock counts' },
        { href: '/erp/stock/warehouses', label: 'Warehouses' },
        { href: '/erp/stock/reports', label: 'Reports' },
      ]}
    />
  );
}
