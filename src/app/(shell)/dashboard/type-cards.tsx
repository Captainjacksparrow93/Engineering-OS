import type { TypeCounts } from '@/modules/project-management/domain/portfolio';

const CARDS: Array<{ key: keyof TypeCounts; label: string; caption: string }> = [
  { key: 'PLC', label: 'PLC', caption: 'active projects' },
  { key: 'SCADA', label: 'SCADA', caption: 'active projects' },
  { key: 'HMI', label: 'HMI', caption: 'active projects' },
  { key: 'onHold', label: 'On hold', caption: 'projects on hold' },
];

/** Project counts per checklist type, plus on hold. Scope is decided by the dashboard service. */
export function TypeCards({ counts }: { counts: TypeCounts }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {CARDS.map((card) => (
        <div key={card.key} className="card border-hairline bg-surface p-4">
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">{card.label}</p>
          <p className="mt-2 text-2xl font-mono text-ink">{counts[card.key]}</p>
          <p className="mt-0.5 text-caption text-muted">
            {counts[card.key] === 1 ? card.caption.replace('projects', 'project') : card.caption}
          </p>
        </div>
      ))}
    </div>
  );
}
