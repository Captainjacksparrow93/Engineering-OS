'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateProjectAction } from '@/app/actions/pm';

interface PanelItem {
  id: string;
  key: string;
  title: string;
  plannedEnd: string;
}

interface ClientOption {
  id: string;
  name: string;
  refNumber: string;
}

interface EditProjectDetailsButtonProps {
  project: {
    id: string;
    code: string;
    name: string;
    clientId: string | null;
    clientName: string;
    workOrderNo: string | null;
    endUserName: string | null;
    applicationName: string | null;
    priority: string;
    startDate: Date | string | null;
    targetEndDate: Date | string | null;
  };
  clients: ClientOption[];
  existingCodes: Array<{ code: string; clientId: string | null }>;
  panels: PanelItem[];
}

function toDateString(val: Date | string | null | undefined): string {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'string') {
    if (val.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return '';
}

export function EditProjectDetailsButton({
  project,
  clients,
  existingCodes,
  panels,
}: EditProjectDetailsButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const [clientId, setClientId] = useState(project.clientId || '');
  const [code, setCode] = useState(project.code || '');
  const [workOrderNo, setWorkOrderNo] = useState(project.workOrderNo || '');
  const [endUserName, setEndUserName] = useState(project.endUserName || '');
  const [applicationName, setApplicationName] = useState(project.applicationName || '');
  const [priority, setPriority] = useState(project.priority || 'MEDIUM');
  const [startDate, setStartDate] = useState(toDateString(project.startDate));
  const [targetEndDate, setTargetEndDate] = useState(toDateString(project.targetEndDate));

  const [panelDates, setPanelDates] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of panels) {
      initial[p.key] = toDateString(p.plannedEnd);
    }
    return initial;
  });

  const [error, setError] = useState<string | null>(null);

  const handleOpen = () => {
    setClientId(project.clientId || '');
    setCode(project.code || '');
    setWorkOrderNo(project.workOrderNo || '');
    setEndUserName(project.endUserName || '');
    setApplicationName(project.applicationName || '');
    setPriority(project.priority || 'MEDIUM');
    setStartDate(toDateString(project.startDate));
    setTargetEndDate(toDateString(project.targetEndDate));

    const initialPanelDates: Record<string, string> = {};
    for (const p of panels) {
      initialPanelDates[p.key] = toDateString(p.plannedEnd);
    }
    setPanelDates(initialPanelDates);
    setError(null);
    setIsOpen(true);
  };

  const handleClose = () => {
    if (isPending) return;
    setIsOpen(false);
    setError(null);
  };

  // Filter existing codes for the chosen client
  const clientCodes = existingCodes
    .filter((c) => !clientId || c.clientId === clientId)
    .map((c) => c.code);
  const uniqueSuggestedCodes = Array.from(new Set(clientCodes));

  const handleSave = () => {
    const trimmedWO = workOrderNo.trim();
    if (trimmedWO && !/^\d+$/.test(trimmedWO)) {
      setError('Work order number must contain digits only.');
      return;
    }

    if (startDate && targetEndDate) {
      const s = new Date(`${startDate}T00:00:00Z`);
      const t = new Date(`${targetEndDate}T00:00:00Z`);
      if (t < s) {
        setError('Target delivery date cannot be before start date.');
        return;
      }

      for (const panel of panels) {
        const pDateStr = panelDates[panel.key];
        if (pDateStr) {
          const pDate = new Date(`${pDateStr}T00:00:00Z`);
          if (pDate < s) {
            setError(`Delivery date for ${panel.title} cannot be before the project start date.`);
            return;
          }
          if (pDate > t) {
            setError(`Delivery date for ${panel.title} cannot be after the project target delivery date.`);
            return;
          }
        }
      }
    }

    const payload: {
      clientId?: string;
      code?: string;
      workOrderNo?: string | null;
      endUserName?: string | null;
      applicationName?: string | null;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      startDate?: string;
      targetEndDate?: string;
      panelDeliveryDates?: Record<string, string>;
    } = {
      clientId: clientId || undefined,
      code: code.trim() || undefined,
      workOrderNo: trimmedWO ? trimmedWO : null,
      endUserName: endUserName.trim() ? endUserName.trim() : null,
      applicationName: applicationName.trim() ? applicationName.trim() : null,
      priority: priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      startDate: startDate || undefined,
      targetEndDate: targetEndDate || undefined,
    };

    if (panels.length > 0) {
      payload.panelDeliveryDates = panelDates;
    }

    startTransition(async () => {
      try {
        const res = await updateProjectAction(project.id, payload);
        if (res.success) {
          setIsOpen(false);
          router.refresh();
        } else {
          setError(res.error || 'Failed to update project details.');
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to update project details.');
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="btn btn-secondary text-body-sm font-medium"
      >
        Edit details
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 text-left">
          <div className="card w-full max-w-2xl max-h-[90vh] flex flex-col bg-surface border border-hairline shadow-2xl overflow-hidden">
            <header className="card-header border-b border-hairline p-4 flex justify-between items-center shrink-0">
              <div>
                <h3 className="card-title text-base font-semibold text-ink">Edit Project Details</h3>
                <p className="text-caption text-muted mt-0.5">
                  Update customer, work order, scheduling or panel delivery dates.
                </p>
              </div>
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

            <div className="card-body p-6 space-y-5 overflow-y-auto flex-1">
              {error && (
                <div className="p-3 rounded-lg bg-error/[0.08] border border-error/20 text-xs font-medium text-error">
                  {error}
                </div>
              )}

              {/* Client & Project Code */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-project-client" className="label text-xs font-semibold">
                    Client / Customer
                  </label>
                  <select
                    id="edit-project-client"
                    value={clientId}
                    onChange={(e) => {
                      setClientId(e.target.value);
                      if (error) setError(null);
                    }}
                    className="select text-sm w-full font-medium"
                    disabled={isPending}
                  >
                    <option value="">[ Choose Client ]</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.refNumber})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="edit-project-code" className="label text-xs font-semibold">
                    Project code
                  </label>
                  <input
                    id="edit-project-code"
                    list="edit-existing-project-codes"
                    type="text"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      if (error) setError(null);
                    }}
                    maxLength={32}
                    placeholder="e.g. ACS-0001-0001"
                    className="input text-sm w-full font-mono uppercase"
                    disabled={isPending}
                  />
                  <datalist id="edit-existing-project-codes">
                    {uniqueSuggestedCodes.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Work Order & Priority */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-project-wo" className="label text-xs font-semibold">
                    Work order number
                  </label>
                  <input
                    id="edit-project-wo"
                    type="text"
                    value={workOrderNo}
                    onChange={(e) => {
                      setWorkOrderNo(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Digits only (leave blank for service call)"
                    className="input text-sm w-full font-mono"
                    disabled={isPending}
                  />
                </div>

                <div>
                  <label htmlFor="edit-project-priority" className="label text-xs font-semibold">
                    Priority
                  </label>
                  <select
                    id="edit-project-priority"
                    value={priority}
                    onChange={(e) => {
                      setPriority(e.target.value);
                      if (error) setError(null);
                    }}
                    className="select text-sm w-full font-medium"
                    disabled={isPending}
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
              </div>

              {/* End User & Application */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-project-enduser" className="label text-xs font-semibold">
                    End user name
                  </label>
                  <input
                    id="edit-project-enduser"
                    type="text"
                    value={endUserName}
                    onChange={(e) => {
                      setEndUserName(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="e.g. Reliance Jamnagar"
                    className="input text-sm w-full"
                    disabled={isPending}
                  />
                </div>

                <div>
                  <label htmlFor="edit-project-app" className="label text-xs font-semibold">
                    Application name
                  </label>
                  <input
                    id="edit-project-app"
                    type="text"
                    value={applicationName}
                    onChange={(e) => {
                      setApplicationName(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="e.g. Boiler Automation"
                    className="input text-sm w-full"
                    disabled={isPending}
                  />
                </div>
              </div>

              {/* Start Date & Target Delivery Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-hairline">
                <div>
                  <label htmlFor="edit-project-start" className="label text-xs font-semibold">
                    Start date
                  </label>
                  <input
                    id="edit-project-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      if (error) setError(null);
                    }}
                    className="input text-sm w-full font-mono"
                    disabled={isPending}
                  />
                </div>

                <div>
                  <label htmlFor="edit-project-target" className="label text-xs font-semibold">
                    Target delivery date
                  </label>
                  <input
                    id="edit-project-target"
                    type="date"
                    value={targetEndDate}
                    onChange={(e) => {
                      setTargetEndDate(e.target.value);
                      if (error) setError(null);
                    }}
                    className="input text-sm w-full font-mono"
                    disabled={isPending}
                  />
                </div>
              </div>

              {/* Panel Delivery Dates (if project has panels) */}
              {panels.length > 0 && (
                <div className="pt-2 border-t border-hairline space-y-3">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Panel Delivery Dates
                    </h4>
                    <p className="text-[11px] text-muted mt-0.5">
                      Each panel&apos;s delivery date must fall between the project start and target delivery date.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {panels.map((panel) => (
                      <div key={panel.id}>
                        <label
                          htmlFor={`panel-date-${panel.key}`}
                          className="label text-xs font-medium"
                        >
                          {panel.title}
                        </label>
                        <input
                          id={`panel-date-${panel.key}`}
                          type="date"
                          value={panelDates[panel.key] || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPanelDates((prev) => ({ ...prev, [panel.key]: val }));
                            if (error) setError(null);
                          }}
                          className="input text-sm w-full font-mono"
                          disabled={isPending}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <footer className="card-footer border-t border-hairline p-4 flex justify-end gap-2 shrink-0 bg-surface">
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
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
