import { AreaTabs } from '../_components/parts';

export function AssetTabs({ current }: { current: string }) {
  return (
    <AreaTabs
      current={current}
      tabs={[
        { href: '/erp/assets', label: 'Overview' },
        { href: '/erp/assets/register', label: 'Assets' },
        { href: '/erp/assets/maintenance', label: 'Maintenance' },
        { href: '/erp/assets/breakdowns', label: 'Breakdowns' },
        { href: '/erp/assets/depreciation', label: 'Depreciation' },
        { href: '/erp/assets/categories', label: 'Categories' },
      ]}
    />
  );
}
