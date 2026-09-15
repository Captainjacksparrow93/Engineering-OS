'use client';

import { useState, useTransition } from 'react';
import { TEST_PERSONAS, type TestPersona } from '@/core/auth/test-personas';
import { quickSwitchPersona } from '@/app/actions/auth';

export function QuickLoginButtons() {
  const [isPending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleQuickLogin = (persona: TestPersona) => {
    if (isPending) return;
    setSelectedId(persona.id);
    startTransition(async () => {
      try {
        await quickSwitchPersona(persona.email, '/dashboard');
      } catch (err) {
        console.error('Quick login failed:', err);
        setSelectedId(null);
      }
    });
  };

  return (
    <div className="mt-base rounded-xl border border-amber-200 bg-amber-50/50 p-base">
      <div className="mb-sm flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-900">
          <span className="inline-block h-2 w-2 animate-ping rounded-full bg-amber-500" />
          ⚡ 1-Click Testing Login (No Password)
        </p>
        <span className="text-[10px] text-amber-700 font-medium">Dev Mode</span>
      </div>
      <p className="mb-base text-xs text-amber-800/80">
        Click any role below to instantly log in without typing email or password:
      </p>

      <div className="grid grid-cols-1 gap-2">
        {TEST_PERSONAS.map((persona) => {
          const isLoading = selectedId === persona.id && isPending;

          return (
            <button
              key={persona.id}
              type="button"
              onClick={() => handleQuickLogin(persona)}
              disabled={isPending}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-all shadow-sm ${
                isLoading
                  ? 'border-amber-400 bg-amber-100 text-amber-950 font-bold'
                  : 'border-hairline bg-canvas hover:border-amber-300 hover:bg-amber-50/80 text-ink'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{persona.tag.split(' ')[0]}</span>
                <div>
                  <div className="font-semibold text-ink">{persona.name}</div>
                  <div className="text-[11px] text-body">{persona.roleLabel}</div>
                </div>
              </div>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold border ${persona.badgeClass}`}>
                {isLoading ? 'Signing in…' : persona.shortRole}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
