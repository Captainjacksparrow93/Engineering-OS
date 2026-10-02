/**
 * Standard project label formatting across cards, selects, and portfolios.
 *
 * Examples:
 *   WO 6934 · Reliance Industries
 *   SERVICE CALL · Torrent Pharma
 */

export interface ProjectLabelInput {
  code?: string | null;
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
    const parts = [p.code, 'SERVICE CALL', p.clientName].filter(Boolean);
    return parts.join(` ${separator} `);
  }

  const woPart = p.workOrderNo
    ? `WO ${p.workOrderNo}`
    : p.name && p.name !== p.code
      ? p.name
      : null;

  const parts: string[] = [];
  if (p.code) parts.push(p.code);
  if (woPart) parts.push(woPart);
  if (parts.length === 0) parts.push('Project');

  if (p.clientName && !parts.some((part) => part.includes(p.clientName!))) {
    parts.push(p.clientName);
  }

  return parts.join(` ${separator} `);
}
