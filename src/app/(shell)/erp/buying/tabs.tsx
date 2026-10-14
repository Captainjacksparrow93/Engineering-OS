import { AreaTabs } from '../_components/parts';

export function BuyingTabs({ current }: { current: string }) {
  return (
    <AreaTabs
      current={current}
      tabs={[
        { href: '/erp/buying', label: 'Overview' },
        { href: '/erp/buying/requests', label: 'Material requests' },
        { href: '/erp/buying/quotations', label: 'Supplier quotations' },
        { href: '/erp/buying/orders', label: 'Purchase orders' },
        { href: '/erp/buying/receipts', label: 'Receipts' },
        { href: '/erp/buying/invoices', label: 'Purchase invoices' },
        { href: '/erp/buying/suppliers', label: 'Suppliers' },
      ]}
    />
  );
}
