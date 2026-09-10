import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { signOut } from '@/app/actions/auth';
import type { Principal } from '@/core/rbac/types';

export function Topbar({ principal, unread }: { principal: Principal; unread: number }) {
  const roleLabel = principal.roleKeys.length
    ? principal.roleKeys.map((key) => key.replaceAll('_', ' ').toLowerCase()).join(' · ')
    : 'no role assigned';

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-surface-border bg-white/90 px-4 py-2.5 backdrop-blur md:px-6">
      <div className="flex items-center gap-3">
        <Link href="/modules" className="text-sm font-medium text-slate-600 hover:text-brand-600 md:hidden">
          Menu
        </Link>
        <p className="text-sm text-slate-500">
          Signed in as <span className="font-medium text-slate-800">{principal.fullName}</span>
          <span className="ml-2 hidden rounded-full bg-slate-100 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-500 sm:inline">
            {roleLabel}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/notifications" className="relative text-slate-500 hover:text-brand-600" title="Notifications">
          <span className="text-lg" aria-hidden>
            🔔
          </span>
          {unread > 0 ? (
            <span className="absolute -right-1.5 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Link>
        <Avatar name={principal.fullName} color={principal.avatarColor} size={30} />
        <form action={signOut}>
          <button type="submit" className="btn btn-secondary btn-sm">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
