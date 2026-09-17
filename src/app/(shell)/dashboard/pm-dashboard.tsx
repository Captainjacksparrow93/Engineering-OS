'use client';

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { formatDate } from '@/core/utils/dates';
import { ProgressBar } from '@/components/ui';
import type { PMDashboardData } from '@/modules/project-management/services/dashboard.service';
import { HealthBadge } from './director-dashboard';

const ATTENTION_PREVIEW = 6;

export function PMDashboard({ data }: { data: PMDashboardData }) {
  const [showAll, setShowAll] = useState(false);
  const attentionRows = showAll ? data.needsAttention : data.needsAttention.slice(0, ATTENTION_PREVIEW);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title text-ink">Project Manager Dashboard</h1>
          <p className="mt-1 text-body-sm text-muted">
            Track your active automation projects, deliverables and team allocations.
          </p>
        </div>
      </div>

      {/* 4 Headline KPI Tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Link
          href="/pm/my-work"
          className="card border-hairline bg-surface p-4 hover:border-hairline-strong transition-colors block"
        >
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Overdue steps</p>
          <p className="mt-2 text-2xl font-bold font-mono text-error">{data.headline.overdueSteps}</p>
          <p className="mt-0.5 text-caption text-muted">Across your projects</p>
        </Link>

        <Link
          href="/pm/my-work"
          className="card border-hairline bg-surface p-4 hover:border-hairline-strong transition-colors block"
        >
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Problems reported</p>
          <p className="mt-2 text-2xl font-bold font-mono text-error">{data.headline.problemsReported}</p>
          <p className="mt-0.5 text-caption text-muted">Open, not yet solved</p>
        </Link>

        <Link
          href="/pm/approvals"
          className="card border-hairline bg-surface p-4 hover:border-hairline-strong transition-colors block"
        >
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Awaiting approval</p>
          <p className="mt-2 text-2xl font-bold font-mono text-ink">{data.headline.awaitingMyApproval}</p>
          <p className="mt-0.5 text-caption text-muted">Steps ready for review</p>
        </Link>

        <Link
          href="/pm/handovers"
          className="card border-hairline bg-surface p-4 hover:border-hairline-strong transition-colors block"
        >
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Handovers waiting</p>
          <p className="mt-2 text-2xl font-bold font-mono text-ink">{data.headline.handoversWaiting}</p>
          <p className="mt-0.5 text-caption text-muted">Waiting on your decision</p>
        </Link>
      </div>

      {/* Needs Attention List */}
      {data.needsAttention.length > 0 ? (
        <div className="card border-hairline bg-surface p-5">
          <header className="flex items-center justify-between border-b border-hairline pb-3">
            <h2 className="card-title text-ink font-semibold">Needs attention</h2>
            <span className="text-caption text-muted">{data.needsAttention.length} items</span>
          </header>
          <div className="divide-y divide-hairline">
            {attentionRows.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-3 gap-4">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-body-sm font-semibold text-ink truncate">{item.title}</p>
                  <p className="text-caption text-muted truncate">{item.subtitle}</p>
                </div>
                <Link href={item.link} className="btn btn-secondary btn-sm shrink-0 text-xs font-medium">
                  {item.actionLabel} →
                </Link>
              </div>
            ))}
            {data.needsAttention.length > ATTENTION_PREVIEW ? (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="w-full pt-3 text-caption font-medium text-ink hover:underline"
              >
                {showAll ? 'Show fewer' : `See all ${data.needsAttention.length}`}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* My Projects Table */}
      <div className="card border-hairline bg-surface p-5 space-y-4">
        <header className="flex items-center justify-between border-b border-hairline pb-3">
          <h2 className="card-title text-ink font-semibold">My projects</h2>
          <span className="text-caption text-muted">{data.projects.length} managed</span>
        </header>

        {data.projects.length === 0 ? (
          <div className="py-8 text-center text-body-sm text-muted">
            You do not currently manage any active projects.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[750px]">
              <thead>
                <tr className="select-none text-caption text-muted">
                  <th>Project</th>
                  <th>Client</th>
                  <th className="w-48">Progress</th>
                  <th>Target Finish</th>
                  <th className="text-right">Health</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((p) => {
                  const isLate = p.health === 'LATE';
                  return (
                    <tr key={p.id} className="hover:bg-canvas-soft transition-colors">
                      <td>
                        <div className="space-y-0.5">
                          <Link href={`/pm/projects/${p.id}`} className="font-semibold text-ink hover:underline">
                            {p.name}
                          </Link>
                        </div>
                      </td>
                      <td className="text-body-sm text-muted">{p.clientName}</td>
                      <td>
                        <div className="space-y-1">
                          <ProgressBar value={p.progressPercent} />
                          <div className="flex items-center justify-between text-caption text-muted font-mono">
                            <span>{p.progressPercent}%</span>
                            <span>{p.blockedCount > 0 ? `${p.blockedCount} blocked` : ''}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="space-y-0.5 text-caption">
                          <p className={clsx(isLate ? 'font-semibold text-error' : 'text-ink')}>
                            {formatDate(p.targetEndDate)}
                          </p>
                          {isLate ? (
                            <p className="text-[11px] font-semibold text-error">
                              +{p.daysLate} {p.daysLate === 1 ? 'day' : 'days'} late · forecast {formatDate(p.forecastEndDate)}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-right">
                        <HealthBadge health={p.health} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Team Load Summary */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Overloaded */}
        <div className="card border-hairline bg-surface p-5 space-y-3">
          <header className="border-b border-hairline pb-2 flex items-center justify-between">
            <h3 className="text-title-sm font-semibold text-error">Overloaded engineers</h3>
            <span className="text-caption text-muted">{data.teamLoadSummary.overloaded.length}</span>
          </header>
          {data.teamLoadSummary.overloaded.length === 0 ? (
            <p className="text-caption text-muted py-2">No engineers are currently overloaded.</p>
          ) : (
            <div className="divide-y divide-hairline">
              {data.teamLoadSummary.overloaded.map((eng) => (
                <div key={eng.id} className="flex items-center justify-between py-2 text-body-sm">
                  <span className="font-medium text-ink">{eng.fullName}</span>
                  <span className="font-mono text-error font-semibold">{eng.loadPercent}% load</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Free / Available */}
        <div className="card border-hairline bg-surface p-5 space-y-3">
          <header className="border-b border-hairline pb-2 flex items-center justify-between">
            <h3 className="text-title-sm font-semibold text-success">Free capacity</h3>
            <span className="text-caption text-muted">{data.teamLoadSummary.free.length}</span>
          </header>
          {data.teamLoadSummary.free.length === 0 ? (
            <p className="text-caption text-muted py-2">No engineers are currently free.</p>
          ) : (
            <div className="divide-y divide-hairline">
              {data.teamLoadSummary.free.slice(0, 5).map((eng) => (
                <div key={eng.id} className="flex items-center justify-between py-2 text-body-sm">
                  <span className="font-medium text-ink">{eng.fullName}</span>
                  <span className="badge badge-success text-xs">Available</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
