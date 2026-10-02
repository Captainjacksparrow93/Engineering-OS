'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { quickFindAction } from '@/app/actions/pm';
import { StatusBadge } from '@/components/ui';
import { cleanTaskTitle } from '@/core/utils/strings';

interface QuickProject {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: string;
}

interface QuickTask {
  id: string;
  code: string;
  title: string;
  status: string;
  projectName: string;
}

export function QuickFind() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<QuickProject[]>([]);
  const [tasks, setTasks] = useState<QuickTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // Flattened results for keyboard navigation
  const allResults = [
    ...projects.map((p) => ({ kind: 'project' as const, item: p, url: `/pm/projects/${p.id}` })),
    ...tasks.map((t) => ({ kind: 'task' as const, item: t, url: `/pm/tasks/${t.id}` })),
  ];

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    setQuery('');
    setProjects([]);
    setTasks([]);
    setActiveIndex(0);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

  // Global Ctrl+K / Cmd+K and Escape listener. Escape is handled here rather than only
  // on the input, so the panel still closes after focus has moved elsewhere.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) {
          handleClose();
        } else {
          handleOpen();
        }
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleOpen, handleClose]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!isOpen || query.trim().length < 2) {
      setProjects([]);
      setTasks([]);
      setIsLoading(false);
      setActiveIndex(0);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      const res = await quickFindAction(query);
      if (res.success && res.data) {
        setProjects(res.data.projects);
        setTasks(res.data.tasks);
        setActiveIndex(0);
      }
      setIsLoading(false);
    }, 200);

    return () => clearTimeout(timer);
  }, [query, isOpen]);

  const handleSelect = (url: string) => {
    handleClose();
    router.push(url);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (allResults.length > 0) {
        setActiveIndex((prev) => (prev + 1) % allResults.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (allResults.length > 0) {
        setActiveIndex((prev) => (prev - 1 + allResults.length) % allResults.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allResults[activeIndex]) {
        handleSelect(allResults[activeIndex].url);
      }
    }
  };

  return (
    <>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-2 rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-xs text-muted hover:border-hairline-strong hover:text-ink transition-colors"
        aria-label="Quick find (Ctrl+K)"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span className="hidden sm:inline">Search...</span>
        <kbd className="hidden sm:inline-flex items-center rounded border border-hairline bg-surface-strong px-1 text-[10px] font-mono text-muted">
          Ctrl K
        </kbd>
      </button>

      {/* Modal Dialog */}
      {isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Quick find"
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 sm:pt-24 bg-ink/40 backdrop-blur-sm"
          onClick={handleClose}
        >
          <div
            className="w-full max-w-xl rounded-lg border border-hairline bg-canvas shadow-none overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input Bar */}
            <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3 bg-surface">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-muted shrink-0"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Find projects, steps, or codes..."
                className="w-full bg-transparent text-sm text-ink placeholder:text-muted outline-none"
              />
              {isLoading ? (
                <span className="text-xs text-muted font-mono animate-pulse">Searching...</span>
              ) : (
                <kbd className="rounded border border-hairline bg-surface-strong px-1.5 py-0.5 text-[10px] font-mono text-muted">
                  ESC
                </kbd>
              )}
            </div>

            {/* Results Body */}
            <div className="max-h-96 overflow-y-auto p-2 divide-y divide-hairline">
              {query.trim().length < 2 ? (
                <div className="px-4 py-8 text-center text-caption text-muted">
                  Type at least 2 characters to search across visible projects and steps.
                </div>
              ) : allResults.length === 0 && !isLoading ? (
                <div className="px-4 py-8 text-center text-caption text-muted">
                  No projects or steps match &ldquo;{query}&rdquo;.
                </div>
              ) : (
                <>
                  {/* Projects Group */}
                  {projects.length > 0 ? (
                    <div className="py-1">
                      <p className="px-3 py-1 text-[11px] font-semibold text-muted uppercase tracking-wider">
                        Projects
                      </p>
                      <div className="space-y-0.5">
                        {projects.map((p) => {
                          const idx = allResults.findIndex((r) => r.kind === 'project' && r.item.id === p.id);
                          const isSelected = activeIndex === idx;

                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => handleSelect(`/pm/projects/${p.id}`)}
                              className={clsx(
                                'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors',
                                isSelected ? 'bg-surface-strong text-ink font-medium' : 'text-body hover:bg-surface'
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-body-sm text-ink">{p.name}</p>
                                <p className="truncate text-caption text-muted font-mono">
                                  {p.code} · {p.clientName}
                                </p>
                              </div>
                              <StatusBadge status={p.status} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {/* Tasks Group */}
                  {tasks.length > 0 ? (
                    <div className="py-1">
                      <p className="px-3 py-1 text-[11px] font-semibold text-muted uppercase tracking-wider">
                        Steps & Tasks
                      </p>
                      <div className="space-y-0.5">
                        {tasks.map((t) => {
                          const idx = allResults.findIndex((r) => r.kind === 'task' && r.item.id === t.id);
                          const isSelected = activeIndex === idx;

                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => handleSelect(`/pm/tasks/${t.id}`)}
                              className={clsx(
                                'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors',
                                isSelected ? 'bg-surface-strong text-ink font-medium' : 'text-body hover:bg-surface'
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-body-sm text-ink">{cleanTaskTitle(t.title)}</p>
                                <p className="truncate text-caption text-muted font-mono">
                                  {t.code} · {t.projectName}
                                </p>
                              </div>
                              <StatusBadge status={t.status} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-hairline bg-surface px-4 py-2 text-[11px] text-muted">
              <span>Use ↑ ↓ to navigate, Enter to select</span>
              <span>ESC to close</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
