import { AreaTabs } from '../_components/parts';

export function ManufacturingTabs({ current }: { current: string }) {
  return (
    <AreaTabs
      current={current}
      tabs={[
        { href: '/erp/manufacturing', label: 'Overview' },
        { href: '/erp/manufacturing/work-orders', label: 'Work orders' },
        { href: '/erp/manufacturing/job-cards', label: 'Job cards' },
        { href: '/erp/manufacturing/plans', label: 'Production plans' },
        { href: '/erp/manufacturing/boms', label: 'BOMs' },
        { href: '/erp/manufacturing/workstations', label: 'Workstations' },
      ]}
    />
  );
}
