import { AreaTabs } from '../_components/parts';

export function SellingTabs({ current }: { current: string }) {
  return (
    <AreaTabs
      current={current}
      tabs={[
        { href: '/erp/selling', label: 'Overview' },
        { href: '/erp/selling/orders', label: 'Sales orders' },
        { href: '/erp/selling/deliveries', label: 'Deliveries' },
        { href: '/erp/selling/invoices', label: 'Sales invoices' },
        { href: '/erp/selling/customers', label: 'Customers' },
      ]}
    />
  );
}
