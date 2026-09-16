'use client';

import { useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { TEST_PERSONAS } from '@/core/auth/test-personas';
import { quickSwitchPersona } from '@/app/actions/auth';

interface PersonaSwitcherProps {
  currentEmail: string;
}

export function PersonaSwitcher({ currentEmail }: PersonaSwitcherProps) {
  const [isPending, startTransition] = useTransition();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const pathname = usePathname();

  const handleSwitch = (email: string, id: string) => {
    if (email.toLowerCase() === currentEmail.toLowerCase() || isPending) return;
    setSwitchingTo(id);
    startTransition(async () => {
      try {
        await quickSwitchPersona(email, pathname);
      } catch (err) {
        console.error('Failed to switch persona:', err);
        setSwitchingTo(null);
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {/* Desktop pill buttons */}
      <div className="hidden xl:flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/80 p-1 shadow-sm">
        <span className="flex items-center gap-1 px-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-800">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          Test Role:
        </span>
        <div className="flex items-center gap-1">
          {TEST_PERSONAS.map((persona) => {
            const isActive = persona.email.toLowerCase() === currentEmail.toLowerCase();
            const isTarget = switchingTo === persona.id && isPending;

            return (
              <button
                key={persona.id}
                type="button"
                onClick={() => handleSwitch(persona.email, persona.id)}
                disabled={isPending || isActive}
                title={`Switch to ${persona.name} (${persona.roleLabel})`}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-ink text-canvas shadow-sm cursor-default ring-1 ring-ink'
                    : isTarget
                    ? 'bg-amber-200 text-amber-900 animate-pulse cursor-wait'
                    : 'bg-canvas text-body hover:bg-surface hover:text-ink border border-hairline'
                }`}
              >
                <span>{persona.tag}</span>
                {isActive && (
                  <span className="ml-0.5 rounded bg-canvas/20 px-1 py-0.2 text-[9px] uppercase font-bold text-canvas">
                    Active
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Compact dropdown for smaller screens */}
      <div className="flex xl:hidden items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
        <span className="text-xs font-bold text-amber-800">⚡ Test:</span>
        <select
          value={TEST_PERSONAS.find((p) => p.email.toLowerCase() === currentEmail.toLowerCase())?.email ?? ''}
          onChange={(e) => {
            const selected = TEST_PERSONAS.find((p) => p.email === e.target.value);
            if (selected) handleSwitch(selected.email, selected.id);
          }}
          disabled={isPending}
          className="rounded border border-amber-300 bg-canvas px-1.5 py-0.5 text-xs font-medium text-ink focus:outline-none"
        >
          {TEST_PERSONAS.map((p) => (
            <option key={p.id} value={p.email}>
              {p.tag} ({p.name})
            </option>
          ))}
        </select>
        {isPending && <span className="text-[10px] font-bold text-amber-700 animate-pulse">Switching…</span>}
      </div>
    </div>
  );
}


