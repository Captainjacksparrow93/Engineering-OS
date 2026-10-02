'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateClientAction } from '@/app/actions/pm';

interface EditClientButtonProps {
  client: {
    id: string;
    name: string;
    refNumber: string;
  };
}

export function EditClientButton({ client }: EditClientButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(client.name);
  const [refNumber, setRefNumber] = useState(client.refNumber);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleOpen = () => {
    setName(client.name);
    setRefNumber(client.refNumber);
    setError(null);
    setIsOpen(true);
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
        const res = await updateClientAction(client.id, trimmedName, trimmedRef);
        if (res.success) {
          setIsOpen(false);
          router.refresh();
        } else {
          setError(res.error || 'Failed to update client.');
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to update client.');
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="btn btn-secondary text-body-sm"
      >
        Edit client
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 text-left">
          <div className="card w-full max-w-md bg-surface border border-hairline shadow-xl">
            <header className="card-header border-b border-hairline pb-3 flex justify-between items-center">
              <h3 className="card-title text-base font-semibold text-ink">Edit Client Details</h3>
              <button
                type="button"
                onClick={handleClose}
                disabled={isPending}
                className="text-muted hover:text-ink font-bold text-lg p-1"
                aria-label="Close"
              >
                &times;
              </button>
            </header>

            <div className="card-body space-y-4 pt-4">
              <div>
                <label htmlFor="edit-client-name" className="label text-xs font-semibold">
                  Client name *
                </label>
                <input
                  id="edit-client-name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (error) setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSave();
                    }
                  }}
                  placeholder="e.g. Torrent Pharmaceuticals"
                  className="input text-sm w-full font-medium"
                  autoFocus
                  disabled={isPending}
                />
              </div>

              <div>
                <label htmlFor="edit-client-ref" className="label text-xs font-semibold">
                  Client reference *
                </label>
                <input
                  id="edit-client-ref"
                  type="text"
                  value={refNumber}
                  onChange={(e) => {
                    setRefNumber(e.target.value.toUpperCase());
                    if (error) setError(null);
                  }}
                  placeholder="ACS-0001"
                  className="input text-sm w-full font-mono uppercase"
                  disabled={isPending}
                />
                <p className="text-[11px] text-muted mt-1">
                  Format must be ACS-XXXX (e.g. ACS-0042).
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
                  className="btn btn-primary text-sm font-semibold"
                >
                  {isPending ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
