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
    <aside className="hidden w-64 shrink-0 flex-col border-r border-hairline bg-canvas md:flex">
      {/* The wordmark is one of only two places Cursor Orange is allowed. */}
      <div className="flex h-16 items-center border-b border-hairline px-lg">
        <Link href="/dashboard" className="flex items-baseline gap-xxs">
          <span className="text-display-sm text-primary">Engineering</span>
          <span className="text-display-sm text-ink">OS</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-sm py-md">
        <p className="px-sm pb-xs text-caption-uppercase uppercase text-muted-soft">Project management</p>
        {PM_NAV.filter(visible).map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} />
        ))}

        {adminItems.length ? (
          <>
            <p className="mt-lg px-sm pb-xs text-caption-uppercase uppercase text-muted-soft">Administration</p>
            {adminItems.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} />
            ))}
          </>
        ) : null}

        <p className="mt-lg px-sm pb-xs text-caption-uppercase uppercase text-muted-soft">Other modules</p>
        <NavLink href="/modules" label="All modules" />
        {upcoming.map((module) => (
          <Link
            key={module.key}
            href={module.route}
            className="flex items-center justify-between gap-xs rounded-sm px-sm py-1.5 text-nav-link text-muted-soft hover:bg-canvas-soft hover:text-body"
          >
            <span className="truncate">{module.name}</span>
            <span className="shrink-0 text-caption-uppercase uppercase text-muted-soft">soon</span>
          </Link>
        ))}
      </nav>

      <div className="border-t border-hairline px-lg py-base">
        <p className="text-caption text-muted-soft">Vidyut Switchgear</p>
      </div>
    </aside>
  );
}
