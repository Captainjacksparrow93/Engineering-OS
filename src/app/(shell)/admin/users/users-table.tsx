'use client';

import React, { useMemo } from 'react';
import { Avatar, StatusBadge } from '@/components/ui';
import { DataTable, type ColumnDef } from '@/components/data-table';
import type { UserStatus } from '@prisma/client';

export interface UserRow {
  id: string;
  fullName: string;
  employeeCode: string;
  email: string;
  avatarColor: string;
  designation: string | null;
  dailyCapacityHours: number;
  status: UserStatus;
  department: { id: string; name: string } | null;
  manager: { id: string; fullName: string } | null;
  roleAssignments: Array<{
    id: string;
    scopeType: string;
    scopeId: string | null;
    role: { key: string; name: string };
  }>;
}

interface UsersTableProps {
  users: UserRow[];
  departments: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; code: string; name: string }>;
}

export function UsersTable({ users, departments, projects }: UsersTableProps) {
  const scopeName = (scopeType: string, scopeId: string | null) => {
    if (scopeType === 'GLOBAL') return 'company-wide';
    if (scopeType === 'DEPARTMENT') return departments.find((d) => d.id === scopeId)?.name ?? 'a department';
    return projects.find((p) => p.id === scopeId)?.code ?? 'a project';
  };

  const columns: ColumnDef<UserRow>[] = useMemo(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        accessor: (u) => u.fullName,
        defaultWidth: 280,
        minWidth: 200,
        cell: (u) => (
          <span className="flex items-center gap-2">
            <Avatar name={u.fullName} color={u.avatarColor} size={28} />
            <span className="min-w-0">
              <span className="block truncate text-body-sm font-medium text-ink">{u.fullName}</span>
              <span className="block truncate text-caption text-muted-soft">
                {u.employeeCode} · {u.email}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: 'department',
        header: 'Department',
        accessor: (u) => u.department?.name ?? '',
        defaultWidth: 200,
        minWidth: 140,
        cell: (u) => (
          <div>
            <span className="block text-caption text-body">{u.department?.name ?? '—'}</span>
            <span className="block text-caption text-muted-soft">{u.designation ?? '—'}</span>
          </div>
        ),
      },
      {
        id: 'reportsTo',
        header: 'Reports to',
        accessor: (u) => u.manager?.fullName ?? '',
        defaultWidth: 160,
        minWidth: 120,
        cell: (u) => (
          <span className="text-caption text-body">{u.manager?.fullName ?? '—'}</span>
        ),
      },
      {
        id: 'capacity',
        header: 'Capacity',
        accessor: (u) => u.dailyCapacityHours,
        defaultWidth: 110,
        minWidth: 90,
        cell: (u) => (
          <span className="text-caption text-body font-mono">{u.dailyCapacityHours}h/day</span>
        ),
      },
      {
        id: 'roles',
        header: 'Roles & scope',
        accessor: (u) => u.roleAssignments.map((r) => r.role.name).join(', '),
        defaultWidth: 260,
        minWidth: 180,
        cell: (u) => (
          <div>
            {u.roleAssignments.length === 0 ? (
              <span className="text-caption text-error">no access</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {u.roleAssignments.map((assignment) => (
                  <span
                    key={assignment.id}
                    className="badge bg-surface-strong text-body"
                    title={assignment.role.name}
                  >
                    {assignment.role.key.replaceAll('_', ' ').toLowerCase()}
                    <span className="text-muted-soft"> @ {scopeName(assignment.scopeType, assignment.scopeId)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        accessor: (u) => u.status,
        defaultWidth: 120,
        minWidth: 100,
        cell: (u) => <StatusBadge status={u.status} />,
      },
    ],
    [departments, projects]
  );

  return (
    <DataTable
      tableId="admin_users"
      data={users}
      columns={columns}
      keyExtractor={(u) => u.id}
      emptyMessage="No employees found matching the current search criteria."
    />
  );
}
