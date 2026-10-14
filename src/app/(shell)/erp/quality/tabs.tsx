import { AreaTabs } from '../_components/parts';

export function QualityTabs({ current }: { current: string }) {
  return (
    <AreaTabs
      current={current}
      tabs={[
        { href: '/erp/quality', label: 'Overview' },
        { href: '/erp/quality/inspections', label: 'Inspections' },
        { href: '/erp/quality/non-conformances', label: 'Non-conformances' },
        { href: '/erp/quality/documents', label: 'Documents' },
        { href: '/erp/quality/templates', label: 'Inspection templates' },
      ]}
    />
  );
}
