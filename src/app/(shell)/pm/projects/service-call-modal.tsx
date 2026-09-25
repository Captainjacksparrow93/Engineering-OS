'use client';

import { useState, useTransition } from 'react';
import { createServiceCallAction } from '@/app/actions/automation-project';

interface ClientItem {
  id: string;
  name: string;
  refNumber: string;
}

interface ManagerItem {
  id: string;
  fullName: string;
  designation?: string | null;
}

export function ServiceCallModal({
  clients,
  managers,
}: {
  clients: ClientItem[];
  managers: ManagerItem[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [managerId, setManagerId] = useState(managers[0]?.id || '');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('HIGH');
  const [description, setDescription] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleOpen = () => {
    setError(null);
    setClientId(clients[0]?.id || '');
    setManagerId(managers[0]?.id || '');
    setPriority('HIGH');
    setDescription('');
    setTargetEndDate('');
    setIsOpen(true);
  };

  const handleClose = () => {
    if (isPending) return;
    setIsOpen(false);
    setError(null);
  };

  const handleSave = () => {
    if (!clientId) {
      setError('Please select a client.');
      return;
    }
    if (!managerId) {
      setError('Please select a project manager.');
      return;
    }

    const selectedClient = clients.find((c) => c.id === clientId);
    if (!selectedClient) {
      setError('Selected client not found.');
      return;
    }

    startTransition(async () => {
      const res = await createServiceCallAction({
        clientId: selectedClient.id,
        clientName: selectedClient.name,
        clientRefNumber: selectedClient.refNumber,
        managerId,
        priority,
        description: description.trim() || undefined,
        targetEndDate: targetEndDate || undefined,
      });

      if (!res.success) {
        setError(res.error || 'Failed to create service call.');
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="btn btn-secondary text-body-sm px-3.5 py-2 font-medium"
      >
        <span className="mr-1 text-primary font-bold">⚡</span> Service call
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 text-left">
          <div className="card w-full max-w-lg bg-surface border border-hairline shadow-xl">
            <header className="card-header border-b border-hairline pb-3 flex justify-between items-center">
              <div>
                <h3 className="card-title text-base font-semibold text-ink flex items-center gap-2">
                  <span>⚡ Urgent Service Call</span>
                  <span className="badge bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs font-bold">
                    No WO
                  </span>
                </h3>
                <p className="text-caption text-muted mt-0.5">
                  Creates an urgent service call project in the client's name without waiting for a Work Order.
                </p>
              </div>
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
              {/* Client Selection */}
              <div>
                <label htmlFor="sc-modal-client" className="label text-xs font-semibold">Client / Customer *</label>
                <select
                  id="sc-modal-client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="select text-sm w-full font-medium"
                  required
                >
                  <option value="">[ Choose Client ]</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.refNumber})
                    </option>
                  ))}
                </select>
              </div>

              {/* Project Manager Selection */}
              <div>
                <label htmlFor="sc-modal-pm" className="label text-xs font-semibold">Project Manager *</label>
                <select
                  id="sc-modal-pm"
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                  className="select text-sm w-full font-medium"
                  required
                >
                  <option value="">[ Choose Project Manager ]</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} {m.designation ? `(${m.designation})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Priority */}
                <div>
                  <label htmlFor="sc-modal-priority" className="label text-xs font-semibold">Priority</label>
                  <select
                    id="sc-modal-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as any)}
                    className="select text-sm w-full font-medium"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High (Urgent)</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>

                {/* Target Date */}
                <div>
                  <label htmlFor="sc-modal-target" className="label text-xs font-semibold">Target Completion Date</label>
                  <input
                    id="sc-modal-target"
                    type="date"
                    value={targetEndDate}
                    onChange={(e) => setTargetEndDate(e.target.value)}
                    className="input text-sm w-full"
                  />
                </div>
              </div>

              {/* Description / Problem */}
              <div>
                <label htmlFor="sc-modal-desc" className="label text-xs font-semibold">Call Reason & Scope</label>
                <textarea
                  id="sc-modal-desc"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the breakdown, issue, or site requirements..."
                  className="input text-sm w-full font-normal"
                />
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
                  {isPending ? 'Creating Call...' : 'Create Service Call'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
