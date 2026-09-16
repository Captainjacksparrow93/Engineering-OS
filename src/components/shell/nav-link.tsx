'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

/** Active state is carried by ink weight and a soft canvas fill - never by orange. */
export function NavLink({
  href,
  label,
  icon,
  badge,
  collapsed = false,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const active =
    pathname === href ||
    (href !== '/dashboard' && pathname.startsWith(`${href}/`)) ||
    (href === '/pm/projects' && pathname.startsWith('/pm/tasks/'));

  return (
    <Link
      href={href}
      title={label}
      className={clsx(
        'group relative flex items-center rounded-sm text-nav-link transition-all',
        collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-2.5 px-sm py-2 w-full',
        active ? 'bg-surface-strong text-ink font-medium' : 'text-body hover:bg-canvas-soft hover:text-ink',
      )}
    >
      {icon ? (
        <span
          className={clsx(
            'shrink-0 transition-colors',
            active ? 'text-ink' : 'text-muted-soft group-hover:text-ink'
          )}
        >
          {icon}
        </span>
      ) : null}
      {!collapsed ? <span className="truncate flex-1 text-left">{label}</span> : null}
      {badge && badge > 0 ? (
        !collapsed ? (
          <span className="ml-auto inline-flex items-center justify-center rounded-pill bg-error px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
            {badge}
          </span>
        ) : (
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-error" />
        )
      ) : null}
    </Link>
  );
}
