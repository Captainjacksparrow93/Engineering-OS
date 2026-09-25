'use client';

import { useMemo, useState, useEffect, useTransition } from 'react';
import Link from 'next/link';
import { Avatar, StatusBadge } from '@/components/ui';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { UserAdminPanel } from './user-admin-panel';
import type { UserStatus } from '@prisma/client';
import { generateSecurePassword, passwordIssues } from '@/core/auth/password';
import { resetUserPasswordAction } from '@/app/actions/admin';

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
  managerId?: string | null;
  roleAssignments: Array<{
    id: string;
    scopeType: string;
    scopeId: string | null;
    role: { key: string; name: string };
  }>;
  createdAt?: string | Date;
  lastSignInAt?: string | Date | null;
  openTasksCount?: number;
  loadHours?: number;
}

interface UsersTableProps {
  users: UserRow[];
  departments: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; code: string; name: string }>;
  canManage?: boolean;
  canAssign?: boolean;
  canResetPassword?: boolean;
  roleOptions?: Array<{ key: string; name: string }>;
  searchQuery?: string;
}

// Format names to clean "First Name + Last Name" only
function formatFirstLastName(fullName: string | null | undefined): string {
  if (!fullName) return '-';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  let first = parts[0]!;
  if (first.toLowerCase().endsWith('kumar') && first.length > 5) {
    first = first.slice(0, -5);
  }
  const last = parts[parts.length - 1]!;
  return `${first} ${last}`;
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return 'Never';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return 'Never';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function PasswordResetSection({
  user,
}: {
  user: UserRow;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'generate' | 'type'>('generate');
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (isOpen && mode === 'generate') {
      setPassword(generateSecurePassword());
      setSuccessInfo(null);
      setError(null);
    }
  }, [isOpen, mode]);

  const handleRegenerate = () => {
    setPassword(generateSecurePassword());
    setCopied(false);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const issues = passwordIssues(password);
    if (issues.length > 0) {
      setError(issues.join(' '));
      return;
    }
    setError(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set('userId', user.id);
      formData.set('password', password);
      const res = await resetUserPasswordAction({}, formData);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccessInfo(password);
      }
    });
  };

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-3 text-body-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-ink">Employee Password</span>
          <p className="text-caption text-muted">Only Directors can reset passwords</p>
        </div>
        {!isOpen && !successInfo && (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="btn btn-secondary btn-xs"
          >
            Set new password
          </button>
        )}
      </div>

      {successInfo && (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-caption font-semibold text-emerald-600 dark:text-emerald-400">
              Password updated for {formatFirstLastName(user.fullName)}
            </span>
            <button
              type="button"
              onClick={() => {
                setSuccessInfo(null);
                setIsOpen(false);
              }}
              className="text-caption text-muted hover:text-ink"
            >
              Done
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 bg-canvas-soft p-2 rounded border border-hairline">
            <code className="font-mono text-body font-bold text-ink select-all break-all">{successInfo}</code>
            <button
              type="button"
              onClick={() => handleCopy(successInfo)}
              className="btn btn-secondary btn-xs shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-caption text-amber-600 dark:text-amber-400">
            Copy and hand this password to the employee in person. It is never retrievable again.
          </p>
        </div>
      )}

      {isOpen && !successInfo && (
        <form onSubmit={handleSubmit} className="space-y-3 pt-2 border-t border-hairline">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('generate')}
              className={`btn btn-xs ${mode === 'generate' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Generate
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('type');
                setPassword('');
              }}
              className={`btn btn-xs ${mode === 'type' ? 'btn-primary' : 'btn-secondary'}`}
            >
              Type one
            </button>
          </div>

          {mode === 'generate' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={password}
                  className="input input-sm font-mono flex-1 bg-canvas-soft"
                />
                <button
                  type="button"
                  onClick={handleRegenerate}
                  className="btn btn-secondary btn-xs"
                  title="Generate another"
                >
                  Regenerate
                </button>
              </div>
              <p className="text-caption text-muted">
                Generated password satisfies minimum 10 characters, upper, lower, and digits.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                placeholder="Enter at least 10 characters..."
                className="input input-sm font-mono w-full"
                autoFocus
              />
              {password.length > 0 && (
                <div className="text-caption space-y-1">
                  {passwordIssues(password).map((issue, idx) => (
                    <p key={idx} className="text-error">• {issue}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-caption text-error">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setError(null);
              }}
              className="btn btn-secondary btn-xs"
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-xs"
              disabled={isPending || (mode === 'type' && passwordIssues(password).length > 0)}
            >
              {isPending ? 'Saving...' : 'Save password'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const ROLE_PRIORITY: Record<string, number> = {
  SUPER_ADMIN: 1,
  DIRECTOR: 2,
  DEPARTMENT_HEAD: 3,
  PROJECT_MANAGER: 4,
  LEAD_ENGINEER: 5,
  SENIOR_ENGINEER: 6,
  ENGINEER: 7,
  JUNIOR_ENGINEER: 8,
  TRAINEE: 9,
  VIEWER: 10,
};

function getPrimaryRole(assignments: UserRow['roleAssignments']) {
  if (!assignments || assignments.length === 0) return null;
  const sorted = [...assignments].sort(
    (a, b) => (ROLE_PRIORITY[a.role.key] ?? 99) - (ROLE_PRIORITY[b.role.key] ?? 99)
  );
  return { primary: sorted[0]!, total: sorted.length, all: sorted };
}

export function UsersTable({
  users,
  departments,
  projects,
  canManage,
  canAssign,
  canResetPassword,
  roleOptions = [],
  searchQuery = '',
}: UsersTableProps) {
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [searchTerm, setSearchTerm] = useState(searchQuery);

  useEffect(() => {
    setSearchTerm(searchQuery);
  }, [searchQuery]);

  // Close drawer on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedUser(null);
    }
    if (selectedUser) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [selectedUser]);

  const scopeName = (scopeType: string, scopeId: string | null) => {
    if (scopeType === 'GLOBAL') return 'Company-wide';
    if (scopeType === 'DEPARTMENT') return departments.find((d) => d.id === scopeId)?.name ?? 'Department';
    return projects.find((p) => p.id === scopeId)?.name ?? 'Project';
  };

  // Priority search: Employee Name matches are ranked highest, followed by Code, Department, Role
  const filteredUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return users;

    const tokens = q.split(/\s+/).filter(Boolean);

    const scored = users
      .map((u) => {
        const displayName = formatFirstLastName(u.fullName).toLowerCase();
        const rawName = u.fullName.toLowerCase();
        const dept = (u.department?.name ?? '').toLowerCase();
        const designation = (u.designation ?? '').toLowerCase();
        const code = u.employeeCode.toLowerCase();
        const email = u.email.toLowerCase();
        const status = u.status.toLowerCase();
        const roleKeys = u.roleAssignments.map((a) => a.role.key.toLowerCase());
        const roleNames = u.roleAssignments.map((a) => a.role.name.toLowerCase());

        let score = 0;

        // 1. TOP PRIORITY: Employee Name match (clean display name)
        if (displayName === q) {
          score += 1000;
        } else if (displayName.startsWith(q)) {
          score += 800;
        } else if (displayName.includes(q)) {
          score += 600;
        } else if (tokens.length > 1 && tokens.every((t) => displayName.includes(t))) {
          score += 500;
        } else if (tokens.some((t) => displayName.startsWith(t))) {
          score += 300;
        } else if (rawName.startsWith(q) || (tokens.length > 1 && tokens.every((t) => rawName.includes(t)))) {
          score += 250;
        }

        // 2. Employee Code (e.g. ACS-0013)
        if (code === q || code.startsWith(q)) {
          score += 200;
        }

        // 3. Department (e.g. "Sales & Estimation", "Technical")
        if (dept === q) {
          score += 180;
        } else if (dept.startsWith(q)) {
          score += 150;
        } else if (dept.includes(q)) {
          score += 120;
        }

        // 4. Role & Designation
        if (roleKeys.some((k) => k.includes(q.replace(/\s+/g, '_'))) || roleNames.some((n) => n.includes(q))) {
          score += 100;
        } else if (designation.includes(q)) {
          score += 80;
        }

        // 5. Work Email
        if (email.startsWith(q)) {
          score += 50;
        }

        // 6. Status
        if (status === q) {
          score += 20;
        }

        return { user: u, score, displayName };
      })
      .filter((item) => item.score > 0);

    // Sort by relevance score descending so Employee Name matches are ALWAYS at the top
    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.displayName.localeCompare(b.displayName);
    });

    return scored.map((item) => item.user);
  }, [users, searchTerm]);

  const columns: ColumnDef<UserRow>[] = useMemo(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        accessor: (u) => formatFirstLastName(u.fullName),
        defaultWidth: 220,
        minWidth: 160,
        cell: (u) => (
          <div className="flex items-center gap-2.5">
            <Avatar name={formatFirstLastName(u.fullName)} color={u.avatarColor} size={28} />
            <span className="truncate text-body-sm font-medium text-ink">
              {formatFirstLastName(u.fullName)}
            </span>
          </div>
        ),
      },
      {
        id: 'role',
        header: 'Role',
        accessor: (u) => {
          const roleInfo = getPrimaryRole(u.roleAssignments);
          return roleInfo?.primary.role.name || u.designation || '-';
        },
        defaultWidth: 170,
        minWidth: 120,
        cell: (u) => {
          const roleInfo = getPrimaryRole(u.roleAssignments);
          return (
            <div className="truncate">
              {roleInfo ? (
                <span
                  className="text-body-sm text-ink"
                  title={roleInfo.all.map((a) => a.role.name).join(', ')}
                >
                  {roleInfo.primary.role.name}
                  {roleInfo.total > 1 ? (
                    <span className="text-muted ml-1 text-caption">
                      (+{roleInfo.total - 1})
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-caption text-muted">{u.designation ?? '-'}</span>
              )}
            </div>
          );
        },
      },
      {
        id: 'department',
        header: 'Department',
        accessor: (u) => u.department?.name ?? '',
        defaultWidth: 200,
        minWidth: 140,
        cell: (u) => (
          <span className="truncate text-caption text-body">
            {u.department?.name ?? '-'}
          </span>
        ),
      },
      {
        id: 'reportsTo',
        header: 'Reports to',
        accessor: (u) => formatFirstLastName(u.manager?.fullName),
        defaultWidth: 170,
        minWidth: 120,
        cell: (u) => (
          <span className="truncate text-caption text-body">
            {formatFirstLastName(u.manager?.fullName)}
          </span>
        ),
      },
      {
        id: 'capacity',
        header: 'Capacity',
        accessor: (u) => u.dailyCapacityHours,
        defaultWidth: 110,
        minWidth: 80,
        cell: (u) => (
          <span className="text-caption text-body font-mono">{u.dailyCapacityHours}h/day</span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        accessor: (u) => u.status,
        defaultWidth: 110,
        minWidth: 90,
        cell: (u) => <StatusBadge status={u.status} />,
      },
    ],
    []
  );

  return (
    <>
      <DataTable
        tableId="admin_users"
        data={filteredUsers}
        columns={columns}
        keyExtractor={(u) => u.id}
        onRowClick={(u) => setSelectedUser(u)}
        emptyMessage="No employees found matching the current search criteria."
        pageSizeOptions={[25, 50, 200]}
        defaultPageSize={25}
        itemNoun="employees"
        renderToolbar={({ columnsButton }) => (
          <div className="mb-2">
            <UserAdminPanel
              canCreate={Boolean(canManage)}
              canAssign={Boolean(canAssign)}
              roles={roleOptions}
              departments={departments}
              projects={projects}
              users={users.map((u) => ({ id: u.id, fullName: u.fullName, employeeCode: u.employeeCode }))}
              searchQuery={searchTerm}
              onSearchChange={setSearchTerm}
              columnsButton={columnsButton}
            />
          </div>
        )}
      />

      {/* Employee Detail Slide-Out Panel */}
      {selectedUser ? (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-ink/30 backdrop-blur-xs transition-opacity"
            onClick={() => setSelectedUser(null)}
          />

          {/* Slide-out Drawer */}
          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-md bg-surface border-l border-hairline flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-base border-b border-hairline bg-canvas-soft">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={formatFirstLastName(selectedUser.fullName)} color={selectedUser.avatarColor} size={40} />
                  <div className="min-w-0">
                    <h3 className="text-body font-semibold text-ink truncate">{formatFirstLastName(selectedUser.fullName)}</h3>
                    <p className="text-caption text-muted truncate">
                      {getPrimaryRole(selectedUser.roleAssignments)?.primary.role.name ?? selectedUser.designation ?? 'Employee'}
                      {selectedUser.department ? ` · ${selectedUser.department.name}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="rounded-md p-1.5 text-muted hover:text-ink hover:bg-surface-strong transition-colors"
                  title="Close (Esc)"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-base space-y-6">
                {/* Account & Contact */}
                <div>
                  <h4 className="text-caption-uppercase font-semibold uppercase text-muted tracking-wider mb-2">Account & Contact</h4>
                  <div className="rounded-lg border border-hairline bg-canvas p-3 space-y-2 text-body-sm">
                    <div className="flex justify-between">
                      <span className="text-muted">Full Name</span>
                      <span className="font-medium text-ink">{formatFirstLastName(selectedUser.fullName)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Employee Code</span>
                      <span className="font-mono text-ink">{selectedUser.employeeCode}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Work Email</span>
                      <span className="text-ink break-all">{selectedUser.email}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted">Status</span>
                      <StatusBadge status={selectedUser.status} />
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Account Created</span>
                      <span className="text-ink">{formatDate(selectedUser.createdAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Last Sign-in</span>
                      <span className="text-ink">{formatDate(selectedUser.lastSignInAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Password Section (Directors only) */}
                {canResetPassword ? (
                  <div>
                    <h4 className="text-caption-uppercase font-semibold uppercase text-muted tracking-wider mb-2">Password</h4>
                    <PasswordResetSection user={selectedUser} />
                  </div>
                ) : null}

                {/* Organization Details */}
                <div>
                  <h4 className="text-caption-uppercase font-semibold uppercase text-muted tracking-wider mb-2">Organization</h4>
                  <div className="rounded-lg border border-hairline bg-canvas p-3 space-y-2 text-body-sm">
                    <div className="flex justify-between">
                      <span className="text-muted">Department</span>
                      <span className="font-medium text-ink">{selectedUser.department?.name ?? '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Designation</span>
                      <span className="text-ink">{selectedUser.designation ?? '-'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted">Reports To</span>
                      {selectedUser.manager ? (
                        <button
                          type="button"
                          onClick={() => {
                            const mgr = users.find(
                              (u) =>
                                u.fullName === selectedUser.manager?.fullName ||
                                (selectedUser.managerId && u.id === selectedUser.managerId)
                            );
                            if (mgr) setSelectedUser(mgr);
                          }}
                          className="text-primary hover:underline font-medium text-left"
                        >
                          {formatFirstLastName(selectedUser.manager.fullName)}
                        </button>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Working Capacity</span>
                      <span className="font-mono text-ink">{selectedUser.dailyCapacityHours} hours / day</span>
                    </div>
                  </div>
                </div>

                {/* Roles & Permissions */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-caption-uppercase font-semibold uppercase text-muted tracking-wider">Assigned Roles & Scopes</h4>
                    {canAssign ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedUser(null);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="text-caption text-primary hover:underline font-medium"
                      >
                        Assign role
                      </button>
                    ) : null}
                  </div>
                  {selectedUser.roleAssignments.length === 0 ? (
                    <div className="rounded-lg border border-hairline bg-canvas p-3">
                      <p className="text-caption text-muted">
                        No app access, so this employee cannot sign in to any module.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {[...selectedUser.roleAssignments]
                        .sort((a, b) => (ROLE_PRIORITY[a.role.key] ?? 99) - (ROLE_PRIORITY[b.role.key] ?? 99))
                        .map((assignment) => (
                          <div key={assignment.id} className="rounded-lg border border-hairline bg-canvas p-3">
                            <span className="font-semibold text-ink text-body-sm">{assignment.role.name}</span>
                            <p className="text-caption text-muted mt-1">
                              Scope: <span className="font-medium text-ink">{scopeName(assignment.scopeType, assignment.scopeId)}</span>
                            </p>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* Workload */}
                <div>
                  <h4 className="text-caption-uppercase font-semibold uppercase text-muted tracking-wider mb-2">Workload</h4>
                  <div className="rounded-lg border border-hairline bg-canvas p-3 space-y-2 text-body-sm">
                    <div className="flex justify-between">
                      <span className="text-muted">Open Tasks</span>
                      <span className="font-mono text-ink">{selectedUser.openTasksCount ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Current Load</span>
                      <span className="font-mono text-ink">{selectedUser.loadHours ?? 0} hrs</span>
                    </div>
                    <div className="pt-2 border-t border-hairline flex justify-end">
                      <Link
                        href={`/pm/resources/${selectedUser.id}`}
                        className="text-caption text-primary hover:underline font-medium inline-flex items-center gap-1"
                      >
                        View workload & tasks →
                      </Link>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-base border-t border-hairline bg-canvas-soft flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="btn btn-secondary btn-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}


