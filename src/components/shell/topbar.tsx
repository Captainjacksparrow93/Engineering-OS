import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { signOut } from '@/app/actions/auth';
import type { Principal } from '@/core/rbac/types';

/** 64px canvas bar, hairline base, no shadow — per the top-nav spec. */
export function Topbar({ principal, unread }: { principal: Principal; unread: number }) {
  const roleLabel = principal.roleKeys.length
    ? principal.roleKeys.map((key) => key.replaceAll('_', ' ')).join(' · ')
    : 'no role assigned';

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-base border-b border-hairline bg-canvas/95 px-base backdrop-blur md:px-xl">
      <div className="flex items-center gap-base">
        <Link href="/modules" className="text-nav-link text-ink md:hidden">
          Menu
        </Link>
        <p className="text-body-sm text-muted">
          Signed in as <span className="text-ink">{principal.fullName}</span>
        </p>
        <span className="badge badge-neutral hidden sm:inline-flex">{roleLabel}</span>
      </div>

      <div className="flex items-center gap-base">
        <Link
          href="/notifications"
          className="flex items-center gap-xs text-nav-link text-body hover:text-ink"
          title="Notifications"
        >
          Inbox
          {unread > 0 ? (
            <span className="inline-flex min-w-[18px] justify-center rounded-pill bg-error px-1.5 py-px text-caption-uppercase text-on-primary">
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
