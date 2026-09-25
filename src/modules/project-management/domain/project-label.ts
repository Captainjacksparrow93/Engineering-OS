/**
 * Standard project label formatting across cards, selects, and portfolios.
 *
 * Examples:
 *   WO 6934 · Reliance Industries
 *   SERVICE CALL · Torrent Pharma
 */

export interface ProjectLabelInput {
  workOrderNo?: string | null;
  name?: string | null;
  clientName?: string | null;
  kind?: string | null;
}

export function projectLabel(
  p: ProjectLabelInput,
  separator: '·' | '—' = '·'
): string {
  const isServiceCall =
    p.kind === 'SERVICE_CALL' ||
    (!p.workOrderNo && Boolean(p.name?.toUpperCase().startsWith('SC ')));

  if (isServiceCall) {
    return p.clientName ? `SERVICE CALL ${separator} ${p.clientName}` : 'SERVICE CALL';
  }

  const prefix = p.workOrderNo ? `WO ${p.workOrderNo}` : (p.name ?? 'Project');
  if (p.clientName && !prefix.includes(p.clientName)) {
    return `${prefix} ${separator} ${p.clientName}`;
  }
  return prefix;
}
