'use client';

import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { signOut } from '@/app/actions/auth';
import type { Principal } from '@/core/rbac/types';
import { formatName } from '@/core/utils/strings';

export function Topbar({ principal, unread }: { principal: Principal; unread: number }) {
  const displayName = formatName(principal.fullName);

  // Format role to clean title (e.g. SUPER_ADMIN / DIRECTOR -> Director)
  const formatRole = (keys: string[]) => {
    if (keys.includes('DIRECTOR') || keys.includes('SUPER_ADMIN')) return 'Director';
    if (keys.length === 0) return 'Member';
    return keys[0]!
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  };

  const displayRole = formatRole(principal.roleKeys);

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-base border-b border-hairline bg-canvas/95 px-base backdrop-blur md:px-xl">
      <div className="flex items-center gap-base">
        {/* Mobile menu trigger */}
        <Link href="/modules" className="text-nav-link text-ink md:hidden">
          Menu
        </Link>

        {/* User identification: First Name + Last Name and clean Role Title */}
        <div className="flex items-center gap-2">
          <span className="text-body-sm font-semibold text-ink">{displayName}</span>
          <span className="badge badge-neutral font-medium text-caption">{displayRole}</span>
        </div>
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
        <Avatar name={displayName} color={principal.avatarColor} size={30} />
        <form action={signOut}>
          <button type="submit" className="btn btn-secondary btn-sm">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

