'use client';

import React from 'react';
import { ShellProvider } from './shell-context';
import { ToastProvider } from '@/components/toast';

export function ShellContainer({
  sidebar,
  topbar,
  children,
}: {
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <ShellProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-canvas text-ink">
        {/* Sidebar slot (width managed dynamically inside Sidebar) */}
        {sidebar}

        {/* Main layout column */}
        <div className="flex h-full flex-1 flex-col min-w-0 overflow-hidden">
          {/* Topbar: pinned at the top, shrink-0 */}
          {topbar}

          {/* Main content viewport: the ONLY container that scrolls */}
          <main className="flex-1 overflow-y-auto px-base py-lg md:px-xl">
            <div className="mx-auto w-full max-w-content">
              {children}
            </div>
          </main>
        </div>
      </div>
    </ShellProvider>
    </ToastProvider>
  );
}
