'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { formatDate } from '@/core/utils/dates';
import type { ClientWithStats } from '@/modules/project-management/services/client.service';

export function ClientsClient({
  clients,
  canCreate,
}: {
  clients: ClientWithStats[];
  canCreate: boolean;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.refNumber.toLowerCase().includes(q)
    );
  }, [clients, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm w-full">
          <input
            type="text"
            placeholder="Search by client name or ACS ref..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input text-body-sm w-full pl-9"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
      </div>

      <div className="card border-hairline bg-surface overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted">
            <p className="text-body font-medium">No clients found</p>
            <p className="text-caption mt-1">
              {search ? 'Try adjusting your search criteria.' : 'No clients are registered in this company.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead className="border-b border-hairline bg-surface-strong/30 text-caption font-semibold text-muted">
                <tr>
                  <th className="py-3 px-4">Ref Number</th>
                  <th className="py-3 px-4">Client Name</th>
                  <th className="py-3 px-4 text-center">Active Projects</th>
                  <th className="py-3 px-4 text-center">Completed</th>
                  <th className="py-3 px-4 text-center">Total Projects</th>
                  <th className="py-3 px-4">Last Project Date</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filtered.map((client) => (
                  <tr
                    key={client.id}
                    className="hover:bg-surface-strong/20 transition-colors group"
                  >
                    <td className="py-3.5 px-4 font-mono text-xs font-semibold text-ink">
                      {client.refNumber}
                    </td>
                    <td className="py-3.5 px-4">
                      <Link
                        href={`/pm/clients/${client.id}`}
                        className="font-semibold text-ink hover:text-primary hover:underline"
                      >
                        {client.name}
                      </Link>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {client.activeProjectsCount > 0 ? (
                        <span className="badge bg-primary/[0.08] text-primary font-bold text-xs">
                          {client.activeProjectsCount} active
                        </span>
                      ) : (
                        <span className="text-caption text-muted">0</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center text-muted">
                      {client.completedProjectsCount}
                    </td>
                    <td className="py-3.5 px-4 text-center font-medium text-ink">
                      {client.totalProjectsCount}
                    </td>
                    <td className="py-3.5 px-4 text-caption text-muted whitespace-nowrap">
                      {client.lastProjectDate ? formatDate(client.lastProjectDate) : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Link
                        href={`/pm/clients/${client.id}`}
                        className="btn btn-secondary btn-sm text-xs group-hover:border-hairline-strong"
                      >
                        View projects →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
