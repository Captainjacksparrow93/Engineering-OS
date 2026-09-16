'use client';

import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { QuickFind } from './quick-find';
import { signOut } from '@/app/actions/auth';
import type { Principal } from '@/core/rbac/types';
import { formatName } from '@/core/utils/strings';

const BellIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

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
        {/* User identification: First Name + Last Name and clean Role Title */}
        <div className="flex items-center gap-2">
          <span className="text-body-sm font-semibold text-ink">{displayName}</span>
          <span className="hidden sm:inline-flex badge badge-neutral font-medium text-caption">{displayRole}</span>
        </div>
      </div>

      <div className="flex items-center gap-sm md:gap-base">
        <QuickFind />
        <Link
          href="/notifications"
          className="relative inline-flex items-center justify-center p-2 text-muted hover:text-ink hover:bg-surface-strong rounded-md transition-colors"
          title="Notifications"
          aria-label="Notifications"
        >
          {BellIcon}
          {unread > 0 ? (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-error px-1 text-[10px] font-bold text-on-primary leading-none">
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


