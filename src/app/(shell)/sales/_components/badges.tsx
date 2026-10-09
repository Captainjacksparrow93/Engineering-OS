import clsx from 'clsx';
import type { SalesDealStage, SalesQuoteStatus } from '@prisma/client';

const STAGE: Record<SalesDealStage, [string, string]> = {
  LEAD: ['Lead', 'badge badge-outline'],
  QUALIFIED: ['Qualified', 'stage-pill bg-stage-thinking'],
  QUOTED: ['Quoted', 'stage-pill bg-stage-read'],
  NEGOTIATION: ['Negotiation', 'stage-pill bg-stage-edit'],
  WON: ['Won', 'stage-pill bg-success text-on-primary'],
  LOST: ['Lost', 'badge badge-error'],
};

const QUOTE: Record<SalesQuoteStatus, [string, string]> = {
  DRAFT: ['Draft', 'badge badge-outline'],
  PENDING_APPROVAL: ['Waiting for approval', 'stage-pill bg-stage-read'],
  APPROVED: ['Approved', 'badge badge-success'],
  SENT: ['Sent', 'badge badge-ink'],
  ACCEPTED: ['Accepted', 'stage-pill bg-success text-on-primary'],
  DECLINED: ['Declined', 'badge badge-error'],
  SUPERSEDED: ['Superseded', 'badge badge-neutral text-muted'],
};

export function DealStageBadge({ stage, className }: { stage: SalesDealStage; className?: string }) {
  const [label, style] = STAGE[stage];
  return <span className={clsx(style, className)}>{label}</span>;
}

export function QuoteStatusBadge({ status, className }: { status: SalesQuoteStatus; className?: string }) {
  const [label, style] = QUOTE[status];
  return <span className={clsx(style, className)}>{label}</span>;
}

export const STAGE_NAMES: Record<SalesDealStage, string> = Object.fromEntries(Object.entries(STAGE).map(([k, [l]]) => [k, l])) as Record<SalesDealStage, string>;
