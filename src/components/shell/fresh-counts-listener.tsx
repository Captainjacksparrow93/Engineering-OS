'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps notifications, pending approvals, and handover badge counts fresh.
 * Listens to tab visibility/focus changes and polls on a 60s timer when tab is active.
 */
export function FreshCountsListener() {
  const router = useRouter();

  useEffect(() => {
    const handleFocus = () => {
      if (!document.hidden) {
        router.refresh();
      }
    };

    const interval = setInterval(() => {
      if (!document.hidden) {
        router.refresh();
      }
    }, 60000);

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [router]);

  return null;
}
