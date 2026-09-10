'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      className={clsx(
        'block rounded-md px-2 py-1.5 text-sm transition',
        active ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
      )}
    >
      {label}
    </Link>
  );
}
