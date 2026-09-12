'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

/** Active state is carried by ink weight and a soft canvas fill — never by orange. */
export function NavLink({
  href,
  label,
  icon,
  collapsed = false,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      title={label}
      className={clsx(
        'group flex items-center rounded-sm text-nav-link transition-all',
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
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </Link>
  );
}
