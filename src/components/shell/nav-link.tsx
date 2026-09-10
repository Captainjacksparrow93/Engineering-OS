'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

/** Active state is carried by ink weight and a soft canvas fill — never by orange. */
export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      className={clsx(
        'block rounded-sm px-sm py-1.5 text-nav-link transition-colors',
        active ? 'bg-surface-strong text-ink' : 'text-body hover:bg-canvas-soft hover:text-ink',
      )}
    >
      {label}
    </Link>
  );
}
