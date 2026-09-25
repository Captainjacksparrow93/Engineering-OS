'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClientAction, getNextClientRefAction } from '@/app/actions/pm';

export function AddClientDialog({
  initialDefaultRef = 'ACS-0001',
}: {
  initialDefaultRef?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [refNumber, setRefNumber] = useState(initialDefaultRef);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleOpen = async () => {
    setError(null);
    setName('');
    setIsOpen(true);
    try {
      const res = await getNextClientRefAction();
      if (res.success && res.nextRef) {
        setRefNumber(res.nextRef);
      }
    } catch {
      // Keep initial default
    }
  };

  const handleClose = () => {
    if (isPending) return;
    setIsOpen(false);
    setError(null);
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    const trimmedRef = refNumber.trim().toUpperCase();

    if (!trimmedName || trimmedName.length < 2) {
      setError('Client name must be at least 2 characters.');
      return;
    }
    if (!trimmedRef || !/^ACS-\d{4}$/.test(trimmedRef)) {
      setError('Client reference must follow format ACS-XXXX (e.g. ACS-0042).');
      return;
    }

    startTransition(async () => {
      try {
        const res = await createClientAction(trimmedName, trimmedRef);
        if (res.success) {
          setIsOpen(false);
          setName('');
          router.refresh();
        } else {
          setError(res.error || 'Failed to create client.');
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to create client.');
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="btn btn-primary text-body-sm"
      >
        <span className="mr-1.5 font-bold">+</span> Add client
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 text-left">
          <div className="card w-full max-w-md bg-surface border border-hairline shadow-xl">
            <header className="card-header border-b border-hairline pb-3 flex justify-between items-center">
              <h3 className="card-title text-base font-semibold text-ink">Add New Client</h3>
              <button
                type="button"
                onClick={handleClose}
                disabled={isPending}
                className="text-muted hover:text-ink font-bold text-lg p-1"
              >
                &times;
              </button>
            </header>

            <div className="card-body space-y-4 pt-4">
              <div>
                <label htmlFor="client-modal-name" className="label text-xs font-semibold">Client Name *</label>
                <input
                  id="client-modal-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSave();
                    }
                  }}
                  placeholder="e.g. Torrent Pharmaceuticals"
                  className="input text-sm w-full font-medium"
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="client-modal-ref" className="label text-xs font-semibold">Client Reference (Auto-assigned)</label>
                <input
                  id="client-modal-ref"
                  type="text"
                  value={refNumber}
                  onChange={(e) => setRefNumber(e.target.value)}
                  placeholder="ACS-0001"
                  className="input text-sm w-full font-mono uppercase"
                />
                <p className="text-[11px] text-muted mt-1">
                  Format must be ACS-XXXX. Increments automatically.
                </p>
              </div>

              {error && (
                <div className="p-2.5 rounded bg-error/[0.08] border border-error/20 text-xs text-error">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isPending}
                  className="btn btn-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isPending}
                  className="btn btn-primary text-sm"
                >
                  {isPending ? 'Saving...' : 'Save Client'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
