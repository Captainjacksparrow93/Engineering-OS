import Link from 'next/link';
import { MODULES } from '@/core/modules/registry';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import type { PermissionKey } from '@/core/rbac/permissions';
import type { Principal } from '@/core/rbac/types';
import { NavLink } from './nav-link';

interface NavItem {
  label: string;
  href: string;
  requires?: PermissionKey;
  badge?: string;
}

/**
 * Navigation is permission-driven, not role-name-driven: a junior engineer simply has
 * no "Resource board" link because they hold no `pm.resource.read` grant anywhere.
 */
const PM_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'My work', href: '/pm/my-work' },
  { label: 'Projects', href: '/pm/projects', requires: 'pm.project.read' },
  { label: 'Handovers', href: '/pm/handovers' },
  { label: 'Resource board', href: '/pm/resources', requires: 'pm.resource.read' },
  { label: 'Assign ad-hoc work', href: '/pm/adhoc', requires: 'pm.task.adhoc.create' },
];

const ADMIN_NAV: NavItem[] = [
  { label: 'People', href: '/admin/users', requires: 'admin.user.read' },
  { label: 'Roles & permissions', href: '/admin/roles', requires: 'admin.role.read' },
  { label: 'Audit trail', href: '/admin/audit', requires: 'admin.audit.read' },
];

export function Sidebar({ principal }: { principal: Principal }) {
  const visible = (item: NavItem) => !item.requires || hasPermissionAnywhere(principal, item.requires);
  const adminItems = ADMIN_NAV.filter(visible);
  const upcoming = MODULES.filter((m) => m.status === 'COMING_SOON');

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-surface-border bg-white md:flex">
      <div className="flex items-center gap-2 border-b border-surface-border px-4 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">⚡</span>
        <div>
          <p className="text-sm font-semibold leading-tight text-slate-900">Engineering OS</p>
          <p className="text-[11px] leading-tight text-slate-400">Vidyut Switchgear</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Project management</p>
        {PM_NAV.filter(visible).map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} />
        ))}

        {adminItems.length ? (
          <>
            <p className="mt-4 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Administration</p>
            {adminItems.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} />
            ))}
          </>
        ) : null}

        <p className="mt-4 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Other modules</p>
        <NavLink href="/modules" label="All modules" />
        {upcoming.map((module) => (
          <Link
            key={module.key}
            href={module.route}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-slate-400 hover:bg-slate-50"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden>{module.icon}</span>
              {module.name}
            </span>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500">
              soon
            </span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
