'use client';
import { formatName } from '@/core/utils/strings';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { createAutomationProjectAction } from '@/app/actions/automation-project';
import { autoAssignAutomationTeamAction } from '@/app/actions/pm';

interface TemplateItem {
  id: string;
  stepNumber: number;
  code: string;
  title: string;
  recommendedSeniority: string;
  defaultDurationDays: number;
  dependsOnStep: number | null;
  isSimulationSignoff: boolean;
}

interface Template {
  id: string;
  code: string;
  name: string;
  description: string | null;
  items: TemplateItem[];
}

interface Engineer {
  id: string;
  fullName: string;
  designation: string | null;
  grade: string;
  avatarColor: string;
  managerId: string | null;
}

interface Manager {
  id: string;
  fullName: string;
  designation: string | null;
  grade: string;
}

const SENIORITY_ORDER: Record<string, number> = {
  LEAD_ENGINEER: 1,
  MANAGER: 1,
  ASST_MANAGER: 1,
  SENIOR_ENGINEER: 2,
  ENGINEER: 3,
  JUNIOR_ENGINEER: 3,
  TRAINEE: 4,
};

const SENIORITY_SECTION_LABELS: Record<number, string> = {
  1: 'Assistant Managers / Leads',
  2: 'Senior Engineers',
  3: 'Junior Engineers',
  4: 'Trainee Engineers',
};

export function AutomationProjectWizard({
  managers,
  teamsByPM,
  allEngineers,
  templates,
}: {
  managers: Manager[];
  teamsByPM: Record<string, string[]>;
  allEngineers: Engineer[];
  templates: Template[];
}) {
  // Order details
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [code, setCode] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [orderValue, setOrderValue] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);

  // Scope selection (no default package selected)
  const [selectedScopes, setSelectedScopes] = useState<Record<string, { enabled: boolean; qty: number }>>({
    PLC: { enabled: false, qty: 1 },
    SCADA: { enabled: false, qty: 1 },
    HMI: { enabled: false, qty: 1 },
  });

  // PM selection (no default PM selected)
  const [selectedPMId, setSelectedPMId] = useState<string>('');
  const [filterPMTeamOnly, setFilterPMTeamOnly] = useState<boolean>(true);

  // Task assignments: key = `${templateCode}_${stepNumber}` -> assigneeId
  const [taskAssignments, setTaskAssignments] = useState<Record<string, string>>({});
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [rationales, setRationales] = useState<
    Record<string, { rationale: string; isWeakMatch: boolean; score: number }>
  >({});
  const [autoAssignBanner, setAutoAssignBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Task durations: key = `${templateCode}_${stepNumber}` -> durationDays
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Team members calculation: strictly exclude Project Managers from the technical engineering pool
  const managerIds = new Set(managers.map((m) => m.id));
  const pmTeamUserIds = teamsByPM[selectedPMId] ?? [];
  const technicalEngineers = allEngineers.filter(
    (e) => !managerIds.has(e.id) && e.grade !== 'MANAGER' && !e.designation?.toLowerCase().includes('project manager')
  );
  const candidateEngineers = filterPMTeamOnly && selectedPMId
    ? technicalEngineers.filter((e) => pmTeamUserIds.includes(e.id))
    : technicalEngineers;

  // Group candidates by Seniority Level
  const groupedEngineers: Record<number, Engineer[]> = { 1: [], 2: [], 3: [], 4: [] };
  candidateEngineers.forEach((eng) => {
    const level = SENIORITY_ORDER[eng.grade] ?? 3;
    if (groupedEngineers[level]) {
      groupedEngineers[level].push(eng);
    }
  });

  const toggleScope = (tplCode: string) => {
    setSelectedScopes((prev) => ({
      ...prev,
      [tplCode]: {
        ...prev[tplCode],
        enabled: !prev[tplCode]?.enabled,
        qty: prev[tplCode]?.qty || 1,
      },
    }));
  };

  const setScopeQty = (tplCode: string, qty: number) => {
    const validQty = Math.max(1, Math.min(10, qty));
    setSelectedScopes((prev) => ({
      ...prev,
      [tplCode]: { ...prev[tplCode], qty: validQty },
    }));
  };

  const setTaskAssignee = (tplCode: string, step: number, userId: string) => {
    const key = `${tplCode}_${step}`;
    setTaskAssignments((prev) => ({ ...prev, [key]: userId }));
  };

  const handleAutoAssign = async () => {
    if (!selectedPMId) {
      setAutoAssignBanner({
        type: 'error',
        message: 'Please select a Project Manager in Step 3 before auto-assigning team.',
      });
      return;
    }

    setIsAutoAssigning(true);
    setAutoAssignBanner(null);

    try {
      const tasksPayload: Array<{
        id: string;
        templateCode: string;
        unitIndex: number;
        stepNumber: number;
        title: string;
        recommendedSeniority: string;
        plannedStart: string;
        plannedEnd: string;
        estimatedHours: number;
      }> = [];

      Object.entries(selectedScopes)
        .filter(([_, val]) => val.enabled && val.qty > 0)
        .forEach(([tplCode, scope]) => {
          const tpl = templates.find((t) => t.code === tplCode);
          if (!tpl) return;
          for (let unit = 1; unit <= scope.qty; unit++) {
            tpl.items.forEach((item) => {
              const key = `${tplCode}_${item.stepNumber}`;
              tasksPayload.push({
                id: key,
                templateCode: tplCode,
                unitIndex: unit,
                stepNumber: item.stepNumber,
                title: item.title,
                recommendedSeniority: item.recommendedSeniority || 'SENIOR',
                plannedStart: startDate,
                plannedEnd: targetEndDate || startDate,
                estimatedHours: 8,
              });
            });
          }
        });

      if (tasksPayload.length === 0) {
        setAutoAssignBanner({
          type: 'error',
          message: 'Please enable at least one automation scope package before auto-assigning.',
        });
        return;
      }

      const res = await autoAssignAutomationTeamAction({
        managerId: selectedPMId,
        startDate,
        targetEndDate,
        tasks: tasksPayload,
      });

      if (res.success && res.assignments) {
        const newAssignments: Record<string, string> = { ...taskAssignments };
        const newRationales: Record<string, { rationale: string; isWeakMatch: boolean; score: number }> = {};
        let assignedCount = 0;

        for (const a of res.assignments) {
          if (a.assignedUserId) {
            newAssignments[a.stepId] = a.assignedUserId;
            assignedCount++;
          }
          newRationales[a.stepId] = {
            rationale: a.rationale,
            isWeakMatch: a.isWeakMatch,
            score: a.score,
          };
        }

        setTaskAssignments(newAssignments);
        setRationales(newRationales);
        // Ensure dropdowns can display the assigned engineers even if cross-squad
        setFilterPMTeamOnly(false);
        setAutoAssignBanner({
          type: 'success',
          message: `Auto-assigned ${assignedCount} of ${tasksPayload.length} steps with optimal grade fit and capacity matching.`,
        });
      } else {
        setAutoAssignBanner({
          type: 'error',
          message: res.error || 'Failed to auto-assign team.',
        });
      }
    } catch {
      setAutoAssignBanner({
        type: 'error',
        message: 'An unexpected error occurred during auto-assignment.',
      });
    } finally {
      setIsAutoAssigning(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !clientName.trim() || !selectedPMId) {
      setError('Please fill in Project Name, Client Name, and select a Project Manager.');
      return;
    }

    const scopesPayload = Object.entries(selectedScopes)
      .filter(([_, val]) => val.enabled && val.qty > 0)
      .map(([code, val]) => ({ templateCode: code, quantity: val.qty }));

    if (scopesPayload.length === 0) {
      setError('Please select at least one automation scope package (PLC, SCADA, or HMI).');
      return;
    }

    // Build task list payload
    const tasksPayload: Array<{
      templateCode: string;
      unitIndex: number;
      stepNumber: number;
      title: string;
      assigneeId?: string;
      plannedStart: string;
      plannedEnd: string;
      durationDays: number;
      estimatedHours: number;
    }> = [];

    const startDt = startDate ? new Date(startDate) : new Date();

    for (const scope of scopesPayload) {
      const tpl = templates.find((t) => t.code === scope.templateCode);
      if (!tpl) continue;

      for (let u = 1; u <= scope.quantity; u++) {
        let cursorDate = new Date(startDt);

        for (const item of tpl.items) {
          const key = `${scope.templateCode}_${item.stepNumber}`;
          const assigneeId = taskAssignments[key] || undefined;
          const taskStart = cursorDate.toISOString().split('T')[0];

          const duration = item.defaultDurationDays;

          // Advance cursor by duration days
          const taskEndDt = new Date(cursorDate);
          taskEndDt.setDate(taskEndDt.getDate() + duration);
          const taskEnd = taskEndDt.toISOString().split('T')[0];
          cursorDate = taskEndDt;

          tasksPayload.push({
            templateCode: scope.templateCode,
            unitIndex: u,
            stepNumber: item.stepNumber,
            title: item.title,
            assigneeId,
            plannedStart: taskStart,
            plannedEnd: taskEnd,
            durationDays: duration,
            estimatedHours: duration * 8,
          });
        }
      }
    }

    setError(null);
    startTransition(async () => {
      const res = await createAutomationProjectAction({
        name: name.trim(),
        clientName: clientName.trim(),
        code: code.trim() || undefined,
        poNumber: poNumber.trim() || undefined,
        orderValue: orderValue ? Number(orderValue) : undefined,
        startDate: startDate || undefined,
        targetEndDate: targetEndDate || undefined,
        managerId: selectedPMId,
        scopes: scopesPayload,
        tasks: tasksPayload,
      });

      if (res && !res.success) {
        setError(res.error ?? 'Failed to create project.');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-5xl">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Step 1: Order & Client Details */}
      <section className="card">
        <header className="card-header border-b border-hairline pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              1
            </span>
            <h2 className="card-title text-base font-semibold">Order & Client Details</h2>
          </div>
        </header>
        <div className="card-body grid gap-4 sm:grid-cols-2 pt-4">
          <div className="sm:col-span-2">
            <label className="label text-xs font-semibold" htmlFor="name">
              Project Name *
            </label>
            <input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input text-sm w-full"
              placeholder="e.g. Tata Chemicals - Demineralized Water Automation System"
            />
          </div>

          <div>
            <label className="label text-xs font-semibold" htmlFor="clientName">
              Client Name *
            </label>
            <input
              id="clientName"
              required
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="input text-sm w-full"
              placeholder="e.g. Tata Chemicals Ltd"
            />
          </div>

          <div>
            <label className="label text-xs font-semibold" htmlFor="code">
              Project Code (Optional)
            </label>
            <input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="input text-sm w-full font-mono uppercase"
              placeholder="Auto-generated (e.g. ACS-PRJ-004)"
            />
          </div>

          <div>
            <label className="label text-xs font-semibold" htmlFor="poNumber">
              Customer PO Number
            </label>
            <input
              id="poNumber"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              className="input text-sm w-full"
              placeholder="e.g. PO-TC-8891"
            />
          </div>

          <div>
            <label className="label text-xs font-semibold" htmlFor="orderValue">
              Order Value (₹)
            </label>
            <input
              id="orderValue"
              type="number"
              min="0"
              value={orderValue}
              onChange={(e) => setOrderValue(e.target.value)}
              className="input text-sm w-full"
              placeholder="e.g. 1850000"
            />
          </div>

          <div>
            <label className="label text-xs font-semibold" htmlFor="startDate">
              Kick-off Date
            </label>
            <input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input text-sm w-full"
            />
          </div>

          <div>
            <label className="label text-xs font-semibold" htmlFor="targetEndDate">
              Target Delivery Date *
            </label>
            <input
              id="targetEndDate"
              type="date"
              required
              value={targetEndDate}
              onChange={(e) => setTargetEndDate(e.target.value)}
              className="input text-sm w-full"
            />
          </div>
        </div>
      </section>

      {/* Step 2: Automation Scope & Quantities */}
      <section className="card">
        <header className="card-header border-b border-hairline pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              2
            </span>
            <h2 className="card-title text-base font-semibold">Automation Scope & Quantities</h2>
          </div>
        </header>
        <div className="card-body grid gap-4 sm:grid-cols-3 pt-4">
          {templates.map((tpl) => {
            const scope = selectedScopes[tpl.code] ?? { enabled: false, qty: 1 };
            return (
              <div
                key={tpl.code}
                className={`rounded-lg border p-4 transition-all ${
                  scope.enabled
                    ? 'border-primary bg-primary/[0.03] shadow-sm'
                    : 'border-hairline bg-surface hover:border-hairline-strong'
                }`}
              >
                <div className="flex items-start justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={scope.enabled}
                      onChange={() => toggleScope(tpl.code)}
                      className="rounded text-primary focus:ring-primary h-4 w-4"
                    />
                    <span className="font-semibold text-sm text-ink">{tpl.name}</span>
                  </label>
                </div>

                <p className="text-caption text-muted mt-1.5 mb-3">{tpl.description}</p>

                {scope.enabled && (
                  <div className="flex items-center justify-between pt-2 border-t border-hairline">
                    <span className="text-xs font-medium text-ink">Quantity (Units):</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setScopeQty(tpl.code, scope.qty - 1)}
                        className="flex h-7 w-7 items-center justify-center rounded border border-hairline bg-surface text-sm font-bold text-ink hover:bg-surface-strong transition-colors"
                        title="Decrease quantity"
                      >
                        -
                      </button>
                      <span className="w-10 text-center text-sm font-bold text-ink select-none">
                        {scope.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => setScopeQty(tpl.code, scope.qty + 1)}
                        className="flex h-7 w-7 items-center justify-center rounded border border-hairline bg-surface text-sm font-bold text-ink hover:bg-surface-strong transition-colors"
                        title="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>

                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Step 3: Team Leadership & PM Selection */}
      <section className="card">
        <header className="card-header border-b border-hairline pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              3
            </span>
            <h2 className="card-title text-base font-semibold">Team Leadership (Project Manager)</h2>
          </div>
        </header>
        <div className="card-body grid gap-4 sm:grid-cols-2 pt-4">
          <div>
            <label className="label text-xs font-semibold" htmlFor="managerId">
              Assign Project Manager *
            </label>
            <select
              id="managerId"
              value={selectedPMId}
              onChange={(e) => setSelectedPMId(e.target.value)}
              className="select text-sm w-full font-medium"
              required
            >
              <option value="">Select Project Manager...</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {formatName(m.fullName)} {m.designation ? `(${m.designation})` : ''}
                </option>
              ))}
            </select>
            <p className="text-caption text-muted mt-1">
              The assigned PM will manage task execution, approvals, and team workload.
            </p>
          </div>

          <div className="flex items-center sm:pt-6">
            <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-lg border border-hairline p-3 bg-surface-subtle/40 hover:bg-surface-subtle w-full">
              <input
                type="checkbox"
                checked={filterPMTeamOnly}
                onChange={(e) => setFilterPMTeamOnly(e.target.checked)}
                className="rounded text-primary focus:ring-primary h-4 w-4"
              />
              <div>
                <span className="text-sm font-medium text-ink">Show PM team members only</span>
                <p className="text-caption text-muted">
                  {filterPMTeamOnly
                    ? 'Dropdowns show only direct team members of the selected PM.'
                    : 'Showing all technical personnel grouped by Seniority (Asst Mgr, Sr, Jr, Trainee).'}
                </p>
              </div>
            </label>
          </div>
        </div>
      </section>

      {/* Step 4: 13 Sequential Tasks Breakdown per Unit */}
      <section className="card">
        <header className="card-header border-b border-hairline pb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              4
            </span>
            <h2 className="card-title text-base font-semibold">13 Sequential Checklist Tasks & Assignments</h2>
          </div>
          <button
            type="button"
            onClick={handleAutoAssign}
            disabled={isAutoAssigning}
            className="btn btn-secondary btn-sm flex items-center gap-1.5 font-semibold text-xs"
          >
            {isAutoAssigning ? (
              <>
                <span className="spinner h-3.5 w-3.5 border-2 border-ink border-t-transparent animate-spin rounded-full" />
                <span>Analyzing team capacity…</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>Auto-assign team</span>
              </>
            )}
          </button>
        </header>
        <div className="card-body space-y-8 pt-4">
          {autoAssignBanner && (
            <div
              className={`rounded-lg border p-3 text-xs flex items-center justify-between gap-2 ${
                autoAssignBanner.type === 'success'
                  ? 'border-success/30 bg-success/[0.06] text-ink'
                  : 'border-error/30 bg-error/[0.06] text-ink'
              }`}
            >
              <span>{autoAssignBanner.message}</span>
              <button
                type="button"
                onClick={() => setAutoAssignBanner(null)}
                className="text-muted hover:text-ink font-bold text-xs"
              >
                ✕
              </button>
            </div>
          )}

          {Object.entries(selectedScopes).filter(([_, val]) => val.enabled && val.qty > 0).length === 0 ? (
            <div className="rounded-lg border border-dashed border-hairline p-8 text-center bg-surface-subtle/40">
              <p className="text-sm font-semibold text-ink">No automation packages selected yet</p>
              <p className="text-caption text-muted mt-1">
                Select one or more packages in <strong>Step 2 (PLC, SCADA, or HMI)</strong> above to configure and assign checklist tasks.
              </p>
            </div>
          ) : (
            Object.entries(selectedScopes)
              .filter(([_, val]) => val.enabled && val.qty > 0)
              .map(([tplCode, scope]) => {
                const tpl = templates.find((t) => t.code === tplCode);
                if (!tpl) return null;

                return (
                  <div key={tplCode} className="rounded-lg border border-hairline overflow-hidden">
                    <div className="bg-surface-subtle px-4 py-2.5 border-b border-hairline flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-ink">
                          {tpl.name} (13 Steps)
                        </span>
                        {scope.qty > 1 && (
                          <span className="badge bg-primary/10 text-primary font-bold text-xs">
                            {scope.qty} Units
                          </span>
                        )}
                      </div>
                      <span className="text-caption text-muted font-medium">
                        Standard Automation Checklist Pipeline
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="table w-full text-xs">
                        <thead>
                          <tr className="bg-surface text-muted text-left uppercase tracking-wider">
                            <th className="w-12 text-center">Step</th>
                            <th>Standard Checklist Task</th>
                            <th className="w-32">Seniority</th>
                            <th className="w-64 text-right">Assignee (Technical Pool)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                          {tpl.items.map((item) => {
                            const key = `${tplCode}_${item.stepNumber}`;
                            const selectedUserId = taskAssignments[key] || '';

                            return (
                              <tr key={item.id} className="hover:bg-surface-subtle/50">
                                <td className="text-center font-bold text-muted">{item.stepNumber}</td>
                                <td className="font-medium text-ink">{item.title}</td>
                                <td>
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                                      item.recommendedSeniority === 'ASST_MANAGER'
                                        ? 'bg-indigo-100 text-indigo-800'
                                        : item.recommendedSeniority === 'SENIOR'
                                        ? 'bg-blue-100 text-blue-800'
                                        : item.recommendedSeniority === 'JUNIOR'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {item.recommendedSeniority === 'ASST_MANAGER'
                                      ? 'Asst. Mgr'
                                      : item.recommendedSeniority === 'SENIOR'
                                      ? 'Sr. Eng'
                                      : item.recommendedSeniority === 'JUNIOR'
                                      ? 'Jr. Eng'
                                      : 'Trainee'}
                                  </span>
                                </td>
                                <td className="text-right">
                                  <select
                                    value={selectedUserId}
                                    onChange={(e) =>
                                      setTaskAssignee(tplCode, item.stepNumber, e.target.value)
                                    }
                                    className="select text-xs py-1 w-full"
                                  >
                                    <option value="">[ Unassigned ]</option>
                                    {filterPMTeamOnly ? (
                                      candidateEngineers.map((eng) => (
                                        <option key={eng.id} value={eng.id}>
                                          {formatName(eng.fullName)} ({eng.designation || eng.grade})
                                        </option>
                                      ))
                                    ) : (
                                      <>
                                        {[1, 2, 3, 4].map((lvl) => {
                                          const group = groupedEngineers[lvl];
                                          if (!group || group.length === 0) return null;
                                          return (
                                            <optgroup key={lvl} label={SENIORITY_SECTION_LABELS[lvl]}>
                                              {group.map((eng) => (
                                                <option key={eng.id} value={eng.id}>
                                                  {formatName(eng.fullName)} ({eng.designation || eng.grade})
                                                </option>
                                              ))}
                                            </optgroup>
                                          );
                                        })}
                                      </>
                                    )}
                                  </select>
                                  {rationales[key] && (
                                    <div className="mt-1 flex items-center justify-end">
                                      <span
                                        className={`inline-block text-[11px] px-2 py-0.5 rounded font-medium ${
                                          rationales[key].isWeakMatch
                                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                        }`}
                                      >
                                        {rationales[key].rationale}
                                      </span>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
          )}

        </div>
      </section>

      {/* Step 5: Submission & Action Bar */}
      <div className="flex items-center justify-between border-t border-hairline pt-4">
        <Link href="/pm/projects" className="btn btn-secondary">
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="btn btn-primary px-6 py-2.5 text-sm font-semibold flex items-center gap-2"
        >
          {isPending ? (
            <>
              <span className="spinner h-4 w-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
              <span>Creating Project & Tasks...</span>
            </>
          ) : (
            <span>Create Automation Project & Sequential Tasks</span>
          )}
        </button>
      </div>
    </form>
  );
}
