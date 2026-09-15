'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { createAutomationProjectAction } from '@/app/actions/automation-project';

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

  // Scope selection
  const [selectedScopes, setSelectedScopes] = useState<Record<string, { enabled: boolean; qty: number }>>({
    PLC: { enabled: true, qty: 1 },
    SCADA: { enabled: false, qty: 1 },
    HMI: { enabled: false, qty: 1 },
  });

  // PM selection
  const defaultPM = managers.find((m) => m.fullName.includes('Parth')) ?? managers[0];
  const [selectedPMId, setSelectedPMId] = useState<string>(defaultPM?.id ?? '');
  const [filterPMTeamOnly, setFilterPMTeamOnly] = useState<boolean>(true);

  // Task assignments: key = `${templateCode}_${stepNumber}` -> assigneeId
  const [taskAssignments, setTaskAssignments] = useState<Record<string, string>>({});
  
  // Task durations: key = `${templateCode}_${stepNumber}` -> durationDays
  const [taskDurations, setTaskDurations] = useState<Record<string, number>>({});

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Team members calculation: strictly exclude Project Managers from the technical engineering pool
  const managerIds = new Set(managers.map((m) => m.id));
  const pmTeamUserIds = teamsByPM[selectedPMId] ?? [];
  const technicalEngineers = allEngineers.filter(
    (e) => !managerIds.has(e.id) && e.grade !== 'MANAGER' && !e.designation?.toLowerCase().includes('project manager')
  );
  const candidateEngineers = filterPMTeamOnly
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

  const setTaskDuration = (tplCode: string, step: number, duration: number) => {
    const key = `${tplCode}_${step}`;
    setTaskDurations((prev) => ({ ...prev, [key]: duration }));
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

          const duration = taskDurations[key] ?? item.defaultDurationDays;

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
              onChange={(e) => setCode(e.target.value)}
              className="input text-sm w-full"
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
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName} {m.designation ? `(${m.designation})` : ''}
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
        <header className="card-header border-b border-hairline pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              4
            </span>
            <h2 className="card-title text-base font-semibold">13 Sequential Checklist Tasks & Assignments</h2>
          </div>
        </header>
        <div className="card-body space-y-8 pt-4">
          {Object.entries(selectedScopes)
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
                          <th className="w-24 text-center">Duration</th>
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
                              <td>
                                <p className="font-medium text-ink text-sm">{item.title}</p>
                                <span className="code text-caption text-muted-soft">{item.code}</span>
                                {item.isSimulationSignoff && (
                                  <span className="badge ml-2 bg-purple-100 text-purple-800 text-xs">
                                    Sign-off Gate
                                  </span>
                                )}
                              </td>
                              <td>
                                <span
                                  className={`badge text-xs ${
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
                              <td className="text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <input
                                    type="number"
                                    min={1}
                                    max={30}
                                    value={taskDurations[key] ?? item.defaultDurationDays}
                                    onChange={(e) =>
                                      setTaskDuration(tplCode, item.stepNumber, Number(e.target.value))
                                    }
                                    className="input text-xs w-16 text-center py-1"
                                  />
                                  <span className="text-caption text-muted">d</span>
                                </div>
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
                                        {eng.fullName} ({eng.designation || eng.grade})
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
                                                {eng.fullName} ({eng.designation || eng.grade})
                                              </option>
                                            ))}
                                          </optgroup>
                                        );
                                      })}
                                    </>
                                  )}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

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
