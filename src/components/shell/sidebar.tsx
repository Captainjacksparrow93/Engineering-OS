'use client';

import Link from 'next/link';
import Image from 'next/image';
import clsx from 'clsx';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import type { PermissionKey } from '@/core/rbac/permissions';
import type { Principal } from '@/core/rbac/types';
import { NavLink } from './nav-link';
import { useShell } from './shell-context';

interface NavItem {
  label: string;
  href: string;
  requires?: PermissionKey;
  icon: React.ReactNode;
}

// Minimalist icons crafted for the engineering design system
const Icons = {
  Dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  ),
  MyWork: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  ),
  Projects: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  ),
  Handovers: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  Resources: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 20a6 6 0 0 0-12 0" />
      <circle cx="12" cy="10" r="4" />
      <circle cx="19" cy="11" r="2" />
      <path d="M22 20a4 4 0 0 0-4-3.5" />
    </svg>
  ),
  AdHoc: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" />
      <path d="M12 8v8" />
    </svg>
  ),
  People: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  Roles: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  ),
  Audit: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Modules: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  ),
  Collapse: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
  Expand: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
};

const WORKSPACE_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', requires: 'pm.report.read', icon: Icons.Dashboard },
  { label: 'My work', href: '/pm/my-work', requires: 'pm.handover.request', icon: Icons.MyWork },
  { label: 'Approvals', href: '/pm/approvals', requires: 'pm.progress.review', icon: Icons.Audit },
  { label: 'Requests', href: '/pm/handovers', requires: 'pm.handover.request', icon: Icons.Handovers },
  { label: 'Urgent task', href: '/pm/adhoc', requires: 'pm.task.adhoc.create', icon: Icons.AdHoc },
];

const MANAGEMENT_NAV: NavItem[] = [
  { label: 'Projects', href: '/pm/projects', requires: 'pm.project.read', icon: Icons.Projects },
  { label: 'Team load', href: '/pm/resources', requires: 'pm.resource.read', icon: Icons.Resources },
];

const ADMIN_NAV: NavItem[] = [
  { label: 'Checklists', href: '/pm/templates', requires: 'pm.template.manage', icon: Icons.MyWork },
  { label: 'People', href: '/admin/users', requires: 'admin.user.read', icon: Icons.People },
  { label: 'Roles & permissions', href: '/admin/roles', requires: 'admin.role.read', icon: Icons.Roles },
  { label: 'Audit trail', href: '/admin/audit', requires: 'admin.audit.read', icon: Icons.Audit },
];

export function Sidebar({
  principal,
  pendingHandovers = 0,
  pendingApprovals = 0,
}: {
  principal: Principal;
  pendingHandovers?: number;
  pendingApprovals?: number;
}) {
  const { isCollapsed, toggleCollapsed } = useShell();

  const visible = (item: NavItem) => {
    return !item.requires || hasPermissionAnywhere(principal, item.requires);
  };
  const workspaceItems = WORKSPACE_NAV.filter(visible);
  const managementItems = MANAGEMENT_NAV.filter(visible);
  const adminItems = ADMIN_NAV.filter(visible);

  return (
    <aside
      className={clsx(
        'hidden md:flex h-full flex-col border-r border-hairline bg-canvas transition-[width] duration-200 ease-in-out shrink-0 select-none overflow-hidden',
        isCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Top Header / Logo & Collapse Toggle */}
      <div className={clsx('flex h-16 items-center border-b border-hairline shrink-0', isCollapsed ? 'justify-center px-2' : 'px-lg')}>
        {!isCollapsed ? (
          <div className="flex items-center justify-between w-full">
            <Link href="/dashboard" className="flex items-center" title="ACS Engitech Pvt Ltd">
              <Image
                src="/acs-logo.svg"
                alt="ACS Engitech"
                width={130}
                height={40}
                className="h-9 w-auto object-contain"
                priority
              />
            </Link>
            <button
              type="button"
              onClick={toggleCollapsed}
              title="Collapse sidebar (Ctrl+B)"
              aria-label="Collapse sidebar"
              className="inline-flex items-center justify-center rounded-md border border-hairline p-1.5 text-muted hover:bg-surface-strong hover:text-ink transition-colors"
            >
              {Icons.Collapse}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={toggleCollapsed}
              title="Expand sidebar (Ctrl+B)"
              aria-label="Expand sidebar"
              className="inline-flex items-center justify-center rounded-md border border-hairline p-1.5 text-muted hover:bg-surface-strong hover:text-ink transition-colors"
            >
              {Icons.Expand}
            </button>
          </div>
        )}
      </div>

      {/* Navigation List (Independent scroll container) */}
      <nav className="flex-1 overflow-y-auto px-2 py-md space-y-1">
        {/* Workspace Group */}
        {workspaceItems.length > 0 && (
          <div key="workspace-section">
            {!isCollapsed ? (
              <p className="px-sm pb-xs text-caption-uppercase uppercase text-muted-soft">Workspace</p>
            ) : (
              <div className="my-1 border-t border-hairline-soft" />
            )}
            {workspaceItems.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                badge={
                  item.href === '/pm/handovers'
                    ? pendingHandovers
                    : item.href === '/pm/approvals'
                      ? pendingApprovals
                      : undefined
                }
                collapsed={isCollapsed}
              />
            ))}
          </div>
        )}

        {/* Management Group */}
        {managementItems.length > 0 && (
          <div key="management-section">
            {!isCollapsed ? (
              <p className="mt-lg px-sm pb-xs text-caption-uppercase uppercase text-muted-soft">Management</p>
            ) : (
              <div className="my-2 border-t border-hairline-soft" />
            )}
            {managementItems.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                collapsed={isCollapsed}
              />
            ))}
          </div>
        )}

        {adminItems.length ? (
          <div key="admin-section">
            {!isCollapsed ? (
              <p className="mt-lg px-sm pb-xs text-caption-uppercase uppercase text-muted-soft">Administration</p>
            ) : (
              <div className="my-2 border-t border-hairline-soft" />
            )}
            {adminItems.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} collapsed={isCollapsed} />
            ))}
          </div>
        ) : null}
      </nav>
    </aside>
  );
}
