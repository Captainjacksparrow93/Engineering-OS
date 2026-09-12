'use client';

import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { signOut } from '@/app/actions/auth';
import type { Principal } from '@/core/rbac/types';
import { useShell } from './shell-context';

/** 64px canvas bar, hairline base, no shadow — per the top-nav spec. */
export function Topbar({ principal, unread }: { principal: Principal; unread: number }) {
  const { isCollapsed, toggleCollapsed } = useShell();

  const roleLabel = principal.roleKeys.length
    ? principal.roleKeys.map((key) => key.replaceAll('_', ' ')).join(' · ')
    : 'no role assigned';

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-base border-b border-hairline bg-canvas/95 px-base backdrop-blur md:px-xl">
      <div className="flex items-center gap-base">
        {/* Mobile menu trigger */}
        <Link href="/modules" className="text-nav-link text-ink md:hidden">
          Menu
        </Link>

        {/* Desktop sidebar toggle button */}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={isCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
          className="hidden md:inline-flex items-center justify-center h-8 w-8 rounded-md border border-hairline text-muted hover:text-ink hover:bg-canvas-soft transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </button>

        <p className="text-body-sm text-muted">
          Signed in as <span className="text-ink font-medium">{principal.fullName}</span>
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
