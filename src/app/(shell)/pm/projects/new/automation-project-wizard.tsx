'use client';

import { useState, useTransition, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { formatName, cleanTaskTitle } from '@/core/utils/strings';
import { formatDate } from '@/core/utils/dates';
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
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Step 1: Order details
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [code, setCode] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [orderValue, setOrderValue] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]!);
  const [targetEndDate, setTargetEndDate] = useState('');
  const [step1Error, setStep1Error] = useState<string | null>(null);

  // Step 2: Scope & PM selection
  const [selectedScopes, setSelectedScopes] = useState<Record<string, { enabled: boolean; qty: number }>>({
    PLC: { enabled: true, qty: 1 },
    SCADA: { enabled: false, qty: 1 },
    HMI: { enabled: false, qty: 1 },
  });
  const [selectedPMId, setSelectedPMId] = useState<string>('');
  const [filterPMTeamOnly, setFilterPMTeamOnly] = useState<boolean>(true);
  const [step2Error, setStep2Error] = useState<string | null>(null);

  // Step 3: Team assignments & dates
  // key: `${templateCode}_U${unitIndex}_${stepNumber}` or `${templateCode}_${stepNumber}`
  const [taskAssignments, setTaskAssignments] = useState<Record<string, string>>({});
  const [taskDurations, setTaskDurations] = useState<Record<string, number>>({});
  const [rationales, setRationales] = useState<
    Record<string, { rationale: string; isWeakMatch: boolean; score: number }>
  >({});
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [autoAssignBanner, setAutoAssignBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Initial durations from templates
  useEffect(() => {
    const durations: Record<string, number> = {};
    for (const tpl of templates) {
      for (const item of tpl.items) {
        durations[`${tpl.code}_${item.stepNumber}`] = item.defaultDurationDays;
      }
    }
    setTaskDurations(durations);
  }, [templates]);

  const toggleScope = (tplCode: string) => {
    setSelectedScopes((prev) => ({
      ...prev,
      [tplCode]: {
        enabled: !prev[tplCode]?.enabled,
        qty: prev[tplCode]?.qty || 1,
      },
    }));
  };

  const setScopeQty = (tplCode: string, qty: number) => {
    setSelectedScopes((prev) => ({
      ...prev,
      [tplCode]: {
        enabled: true,
        qty: Math.max(1, Math.min(10, qty)),
      },
    }));
  };

  const toggleUnitExpand = (unitKey: string) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(unitKey)) next.delete(unitKey);
      else next.add(unitKey);
      return next;
    });
  };

  // Active units list
  const activeScopes = useMemo(() => {
    return Object.entries(selectedScopes)
      .filter(([_, val]) => val.enabled && val.qty > 0)
      .map(([code, val]) => ({ templateCode: code, quantity: val.qty }));
  }, [selectedScopes]);

  // Candidates for selected PM
  const candidateEngineers = useMemo(() => {
    if (!selectedPMId) return allEngineers;
    if (!filterPMTeamOnly) return allEngineers;
    const teamUserIds = teamsByPM[selectedPMId] || [];
    return allEngineers.filter((e) => teamUserIds.includes(e.id) || e.id === selectedPMId);
  }, [selectedPMId, filterPMTeamOnly, allEngineers, teamsByPM]);

  // Grouped engineers by seniority for dropdown
  const groupedEngineers = useMemo(() => {
    const groups: Record<number, Engineer[]> = { 1: [], 2: [], 3: [], 4: [] };
    for (const eng of allEngineers) {
      const level = SENIORITY_ORDER[eng.grade] || 3;
      groups[level]!.push(eng);
    }
    for (const lvl of [1, 2, 3, 4]) {
      groups[lvl]!.sort((a, b) => a.fullName.localeCompare(b.fullName));
    }
    return groups;
  }, [allEngineers]);

  // Auto-assign helper
  const handleAutoAssign = useCallback(async () => {
    if (!selectedPMId) {
      setAutoAssignBanner({
        type: 'error',
        message: 'Please select a Project Manager before running team auto-assignment.',
      });
      return;
    }

    setIsAutoAssigning(true);
    setAutoAssignBanner(null);

    try {
      const tasksPayload: Array<{
        stepId: string;
        stepNumber: number;
        title: string;
        recommendedSeniority: string;
        defaultDurationDays: number;
      }> = [];

      for (const scope of activeScopes) {
        const tpl = templates.find((t) => t.code === scope.templateCode);
        if (!tpl) continue;

        for (let u = 1; u <= scope.quantity; u++) {
          for (const item of tpl.items) {
            tasksPayload.push({
              stepId: `${scope.templateCode}_U${u}_${item.stepNumber}`,
              stepNumber: item.stepNumber,
              title: `${item.title} (${scope.templateCode} ${u})`,
              recommendedSeniority: item.recommendedSeniority,
              defaultDurationDays: item.defaultDurationDays,
            });
          }
        }
      }

      if (tasksPayload.length === 0) {
        setIsAutoAssigning(false);
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
        setAutoAssignBanner({
          type: 'success',
          message: `Auto-assigned ${assignedCount} of ${tasksPayload.length} steps based on optimal skill matching and free capacity.`,
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
  }, [selectedPMId, startDate, targetEndDate, activeScopes, templates, taskAssignments]);

  // Step 1 validation
  const handleProceedToStep2 = () => {
    setStep1Error(null);
    if (!name.trim()) {
      setStep1Error('Project name is required.');
      return;
    }
    if (!clientName.trim()) {
      setStep1Error('Client name is required.');
      return;
    }
    if (!targetEndDate) {
      setStep1Error('Target delivery date is required.');
      return;
    }
    if (startDate && targetEndDate && targetEndDate < startDate) {
      setStep1Error('Target delivery date cannot be before start date.');
      return;
    }
    setCurrentStep(2);
  };

  // Step 2 validation
  const handleProceedToStep3 = () => {
    setStep2Error(null);
    if (activeScopes.length === 0) {
      setStep2Error('Please select at least one automation package (e.g. PLC, SCADA, HMI).');
      return;
    }
    if (!selectedPMId) {
      setStep2Error('Please select a Project Manager to lead this project.');
      return;
    }
    setCurrentStep(3);

    // Run auto-assign if not yet populated
    if (Object.keys(taskAssignments).length === 0) {
      setTimeout(() => {
        handleAutoAssign();
      }, 50);
    }
  };

  // Final submit handler
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !clientName.trim() || !selectedPMId) {
      setError('Please fill in Project Name, Client Name, and select a Project Manager.');
      return;
    }

    if (activeScopes.length === 0) {
      setError('Please select at least one automation scope package.');
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

    for (const scope of activeScopes) {
      const tpl = templates.find((t) => t.code === scope.templateCode);
      if (!tpl) continue;

      for (let u = 1; u <= scope.quantity; u++) {
        let cursorDate = new Date(startDt);

        for (const item of tpl.items) {
          const unitKey = `${scope.templateCode}_U${u}_${item.stepNumber}`;
          const fallbackKey = `${scope.templateCode}_${item.stepNumber}`;
          const assigneeId = taskAssignments[unitKey] || taskAssignments[fallbackKey] || undefined;

          const duration = taskDurations[fallbackKey] || item.defaultDurationDays;
          const taskStart = cursorDate.toISOString().split('T')[0]!;
          const taskEndDt = new Date(cursorDate);
          taskEndDt.setDate(taskEndDt.getDate() + duration);
          const taskEnd = taskEndDt.toISOString().split('T')[0]!;
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

    startTransition(async () => {
      const res = await createAutomationProjectAction({
        name: name.trim(),
        clientName: clientName.trim(),
        code: code.trim() || undefined,
        poNumber: poNumber.trim() || undefined,
        orderValue: orderValue ? parseFloat(orderValue) : undefined,
        startDate,
        targetEndDate,
        managerId: selectedPMId,
        scopes: activeScopes,
        tasks: tasksPayload,
      });

      if (!res.success) {
        setError(res.error || 'Failed to create automation project.');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto">
      {/* 3-Step Wizard Stepper */}
      <nav aria-label="Wizard Steps" className="card p-3 bg-surface">
        <div className="flex items-center justify-between sm:justify-center sm:gap-12">
          {/* Step 1 */}
          <button
            type="button"
            onClick={() => setCurrentStep(1)}
            className={clsx(
              'flex items-center gap-2 text-xs sm:text-body-sm font-semibold transition-colors',
              currentStep === 1
                ? 'text-ink'
                : currentStep > 1
                ? 'text-muted hover:text-ink'
                : 'text-muted/60'
            )}
          >
            <span
              className={clsx(
                'flex h-6 w-6 items-center justify-center rounded-pill text-xs font-mono font-bold',
                currentStep === 1
                  ? 'bg-ink text-canvas'
                  : currentStep > 1
                  ? 'bg-surface-strong text-ink border border-hairline'
                  : 'bg-surface-strong text-muted border border-hairline'
              )}
            >
              1
            </span>
            <span>Order details</span>
          </button>

          <span className="h-px w-6 sm:w-12 bg-hairline" />

          {/* Step 2 */}
          <button
            type="button"
            onClick={() => {
              if (currentStep === 1) handleProceedToStep2();
              else setCurrentStep(2);
            }}
            className={clsx(
              'flex items-center gap-2 text-xs sm:text-body-sm font-semibold transition-colors',
              currentStep === 2
                ? 'text-ink'
                : currentStep > 2
                ? 'text-muted hover:text-ink'
                : 'text-muted/60'
            )}
          >
            <span
              className={clsx(
                'flex h-6 w-6 items-center justify-center rounded-pill text-xs font-mono font-bold',
                currentStep === 2
                  ? 'bg-ink text-canvas'
                  : currentStep > 2
                  ? 'bg-surface-strong text-ink border border-hairline'
                  : 'bg-surface-strong text-muted border border-hairline'
              )}
            >
              2
            </span>
            <span>Scope & PM</span>
          </button>

          <span className="h-px w-6 sm:w-12 bg-hairline" />

          {/* Step 3 */}
          <button
            type="button"
            onClick={() => {
              if (currentStep === 1) {
                handleProceedToStep2();
              } else if (currentStep === 2) {
                handleProceedToStep3();
              }
            }}
            className={clsx(
              'flex items-center gap-2 text-xs sm:text-body-sm font-semibold transition-colors',
              currentStep === 3
                ? 'text-ink'
                : 'text-muted/60'
            )}
          >
            <span
              className={clsx(
                'flex h-6 w-6 items-center justify-center rounded-pill text-xs font-mono font-bold',
                currentStep === 3
                  ? 'bg-ink text-canvas'
                  : 'bg-surface-strong text-muted border border-hairline'
              )}
            >
              3
            </span>
            <span>Team & dates</span>
          </button>
        </div>
      </nav>

      {/* Global Error Alert */}
      {error ? (
        <div className="rounded-md border border-error/30 bg-error/[0.04] p-4 text-body-sm text-error">
          {error}
        </div>
      ) : null}

      {/* STEP 1: ORDER DETAILS */}
      {currentStep === 1 ? (
        <section className="card p-5 space-y-4 bg-surface">
          <div>
            <h2 className="text-title-sm font-semibold text-ink">1. Order Details</h2>
            <p className="text-caption text-muted">
              Commercial parameters and delivery commitments for this automation order.
            </p>
          </div>

          {step1Error ? (
            <div className="rounded-md border border-error/30 bg-error/[0.04] p-3 text-caption text-error">
              {step1Error}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label text-xs font-semibold" htmlFor="projectName">
                Project Name *
              </label>
              <input
                id="projectName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 5-Axis Milling Station Automation"
                className="input text-sm w-full"
                required
              />
            </div>

            <div>
              <label className="label text-xs font-semibold" htmlFor="clientName">
                Client / Customer Name *
              </label>
              <input
                id="clientName"
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Tata Motors Ltd"
                className="input text-sm w-full"
                required
              />
            </div>

            <div>
              <label className="label text-xs font-semibold" htmlFor="code">
                Project Code (Optional)
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. ACS-PRJ-2026-0042 (auto-generated if blank)"
                className="input text-sm w-full font-mono"
              />
            </div>

            <div>
              <label className="label text-xs font-semibold" htmlFor="poNumber">
                PO / Order Number
              </label>
              <input
                id="poNumber"
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="e.g. PO-88491-REV2"
                className="input text-sm w-full font-mono"
              />
            </div>

            <div>
              <label className="label text-xs font-semibold" htmlFor="orderValue">
                Order Value (₹ Lakhs)
              </label>
              <input
                id="orderValue"
                type="number"
                step="0.01"
                min="0"
                value={orderValue}
                onChange={(e) => setOrderValue(e.target.value)}
                placeholder="e.g. 45.50"
                className="input text-sm w-full font-mono"
              />
            </div>

            <div>
              <label className="label text-xs font-semibold" htmlFor="startDate">
                Project Start Date
              </label>
              <input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input text-sm w-full font-mono"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="label text-xs font-semibold" htmlFor="targetEndDate">
                Target Delivery Date *
              </label>
              <input
                id="targetEndDate"
                type="date"
                value={targetEndDate}
                onChange={(e) => setTargetEndDate(e.target.value)}
                className="input text-sm w-full font-mono"
                required
              />
              <p className="text-caption text-muted mt-1">
                Contractual finish date promised to customer. Team scheduling will anchor to this deadline.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-hairline pt-4">
            <Link href="/pm/projects" className="btn btn-secondary">
              Cancel
            </Link>
            <button
              type="button"
              onClick={handleProceedToStep2}
              className="btn btn-primary"
            >
              Next: Scope & PM →
            </button>
          </div>
        </section>
      ) : null}

      {/* STEP 2: SCOPE & PROJECT MANAGER */}
      {currentStep === 2 ? (
        <section className="card p-5 space-y-6 bg-surface">
          <div>
            <h2 className="text-title-sm font-semibold text-ink">2. Scope & Project Manager</h2>
            <p className="text-caption text-muted">
              Select automation deliverables (PLC, SCADA, HMI) and choose the designated Project Manager.
            </p>
          </div>

          {step2Error ? (
            <div className="rounded-md border border-error/30 bg-error/[0.04] p-3 text-caption text-error">
              {step2Error}
            </div>
          ) : null}

          {/* Automation Packages */}
          <div className="space-y-3">
            <label className="label text-xs font-semibold">
              Automation Deliverables & Units *
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              {templates.map((tpl) => {
                const scope = selectedScopes[tpl.code] || { enabled: false, qty: 1 };
                return (
                  <div
                    key={tpl.id}
                    className={clsx(
                      'rounded-lg border p-4 transition-colors space-y-3',
                      scope.enabled
                        ? 'border-hairline-strong bg-canvas'
                        : 'border-hairline bg-surface-strong/30 opacity-70 hover:opacity-100'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={scope.enabled}
                          onChange={() => toggleScope(tpl.code)}
                          className="rounded text-ink focus:ring-ink h-4 w-4"
                        />
                        <span className="font-semibold text-ink text-body-sm">{tpl.name}</span>
                      </label>
                      <span className="badge badge-neutral text-caption font-mono">
                        {tpl.items.length} steps
                      </span>
                    </div>

                    <p className="text-caption text-muted line-clamp-2">
                      {tpl.description || `Standard ${tpl.name} pipeline.`}
                    </p>

                    {scope.enabled ? (
                      <div className="flex items-center justify-between border-t border-hairline pt-2.5">
                        <span className="text-caption text-muted">Units / Panels:</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setScopeQty(tpl.code, scope.qty - 1)}
                            disabled={scope.qty <= 1}
                            className="flex h-6 w-6 items-center justify-center rounded border border-hairline bg-surface text-xs font-bold text-ink hover:bg-surface-strong disabled:opacity-40"
                          >
                            -
                          </button>
                          <span className="w-8 text-center text-xs font-bold font-mono text-ink">
                            {scope.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => setScopeQty(tpl.code, scope.qty + 1)}
                            disabled={scope.qty >= 10}
                            className="flex h-6 w-6 items-center justify-center rounded border border-hairline bg-surface text-xs font-bold text-ink hover:bg-surface-strong disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Project Manager Selection */}
          <div className="grid gap-4 sm:grid-cols-2 border-t border-hairline pt-4">
            <div>
              <label className="label text-xs font-semibold" htmlFor="managerId">
                Designated Project Manager *
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
                The PM controls project execution, reviews step deliverables, and manages team workload.
              </p>
            </div>

            <div className="flex items-center sm:pt-6">
              <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-lg border border-hairline p-3 bg-canvas hover:bg-surface-strong/50 w-full">
                <input
                  type="checkbox"
                  checked={filterPMTeamOnly}
                  onChange={(e) => setFilterPMTeamOnly(e.target.checked)}
                  className="rounded text-ink focus:ring-ink h-4 w-4"
                />
                <div>
                  <span className="text-body-sm font-semibold text-ink">Filter to PM direct team</span>
                  <p className="text-caption text-muted">
                    {filterPMTeamOnly
                      ? 'Auto-assign and dropdowns prioritize direct team members of the selected PM.'
                      : 'Auto-assign considers all technical personnel across departments.'}
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-hairline pt-4">
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="btn btn-secondary"
            >
              ← Back: Order Details
            </button>
            <button
              type="button"
              onClick={handleProceedToStep3}
              className="btn btn-primary"
            >
              Next: Review Team & Dates →
            </button>
          </div>
        </section>
      ) : null}

      {/* STEP 3: REVIEW TEAM & DATES */}
      {currentStep === 3 ? (
        <section className="card p-5 space-y-6 bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-title-sm font-semibold text-ink">3. Review Team & Sequential Tasks</h2>
              <p className="text-caption text-muted">
                Engineers auto-matched by seniority fit and free capacity. Expand any unit to customize assignees or dates.
              </p>
            </div>

            <button
              type="button"
              onClick={handleAutoAssign}
              disabled={isAutoAssigning}
              className="btn btn-secondary btn-sm flex items-center gap-1.5 text-xs font-semibold"
            >
              {isAutoAssigning ? (
                <>
                  <span className="h-3.5 w-3.5 border-2 border-ink border-t-transparent animate-spin rounded-full" />
                  <span>Matching team...</span>
                </>
              ) : (
                <>
                  <span>⚡</span>
                  <span>Re-run Auto-Assign</span>
                </>
              )}
            </button>
          </div>

          {/* Auto-assign Banner */}
          {autoAssignBanner ? (
            <div
              className={clsx(
                'rounded-md p-3 text-caption font-medium flex items-center gap-2 border',
                autoAssignBanner.type === 'success'
                  ? 'border-success/30 bg-success/[0.04] text-success'
                  : 'border-error/30 bg-error/[0.04] text-error'
              )}
            >
              <span>{autoAssignBanner.type === 'success' ? '✓' : '⚠️'}</span>
              <span>{autoAssignBanner.message}</span>
            </div>
          ) : null}

          {/* Compact Unit Summaries */}
          <div className="space-y-3">
            {activeScopes.map((scope) => {
              const tpl = templates.find((t) => t.code === scope.templateCode);
              if (!tpl) return null;

              return Array.from({ length: scope.quantity }, (_, i) => i + 1).map((u) => {
                const unitKey = `${scope.templateCode}_U${u}`;
                const isExpanded = expandedUnits.has(unitKey);

                // Collect assigned engineers for this unit
                const assignedNames = new Set<string>();
                let unassignedCount = 0;

                for (const item of tpl.items) {
                  const itemKey = `${scope.templateCode}_U${u}_${item.stepNumber}`;
                  const fallbackKey = `${scope.templateCode}_${item.stepNumber}`;
                  const assignedId = taskAssignments[itemKey] || taskAssignments[fallbackKey];
                  if (assignedId) {
                    const eng = allEngineers.find((e) => e.id === assignedId);
                    if (eng) assignedNames.add(formatName(eng.fullName));
                  } else {
                    unassignedCount++;
                  }
                }

                return (
                  <div
                    key={unitKey}
                    className="rounded-lg border border-hairline bg-canvas overflow-hidden divide-y divide-hairline"
                  >
                    {/* Unit Summary Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded bg-surface-strong text-xs font-mono font-bold text-ink">
                          {u}
                        </span>
                        <div>
                          <p className="font-semibold text-ink text-body-sm">
                            {tpl.name} · Unit {u}
                          </p>
                          <p className="text-caption text-muted">
                            {tpl.items.length} sequential steps · {assignedNames.size > 0 ? `Assigned: ${Array.from(assignedNames).join(', ')}` : 'Unassigned'}
                            {unassignedCount > 0 ? ` (${unassignedCount} pending)` : ''}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-caption text-muted font-mono hidden sm:inline">
                          {formatDate(startDate)} → {formatDate(targetEndDate)}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleUnitExpand(unitKey)}
                          className="btn btn-secondary btn-sm text-xs font-medium"
                        >
                          {isExpanded ? 'Hide steps ▲' : 'Customize steps ▼'}
                        </button>
                      </div>
                    </div>

                    {/* Step-by-Step Checklist Table (When Expanded) */}
                    {isExpanded ? (
                      <div className="overflow-x-auto p-3 bg-surface">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-hairline text-caption font-semibold text-muted">
                            <tr>
                              <th className="py-2 px-2 w-12">#</th>
                              <th className="py-2 px-2">Task / Milestone</th>
                              <th className="py-2 px-2 w-28">Seniority</th>
                              <th className="py-2 px-2 w-24">Days</th>
                              <th className="py-2 px-2 w-64">Assignee</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-hairline">
                            {tpl.items.map((item) => {
                              const itemKey = `${scope.templateCode}_U${u}_${item.stepNumber}`;
                              const fallbackKey = `${scope.templateCode}_${item.stepNumber}`;
                              const selectedUserId = taskAssignments[itemKey] || taskAssignments[fallbackKey] || '';
                              const duration = taskDurations[fallbackKey] || item.defaultDurationDays;
                              const rationaleInfo = rationales[itemKey];

                              return (
                                <tr key={item.id} className="hover:bg-canvas/50">
                                  <td className="py-2 px-2 font-mono font-semibold text-muted">
                                    {item.stepNumber}
                                  </td>
                                  <td className="py-2 px-2">
                                    <p className="font-medium text-ink">{cleanTaskTitle(item.title)}</p>
                                    {item.dependsOnStep ? (
                                      <p className="text-[10px] text-muted font-mono">
                                        Depends on Step {item.dependsOnStep}
                                      </p>
                                    ) : null}
                                  </td>
                                  <td className="py-2 px-2 text-muted">
                                    {item.recommendedSeniority.replaceAll('_', ' ')}
                                  </td>
                                  <td className="py-2 px-2">
                                    <input
                                      type="number"
                                      min="1"
                                      max="90"
                                      value={duration}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) || 1;
                                        setTaskDurations((prev) => ({
                                          ...prev,
                                          [fallbackKey]: val,
                                        }));
                                      }}
                                      className="input text-xs py-1 px-1.5 w-16 font-mono text-center"
                                    />
                                  </td>
                                  <td className="py-2 px-2">
                                    <select
                                      value={selectedUserId}
                                      onChange={(e) => {
                                        const uid = e.target.value;
                                        setTaskAssignments((prev) => ({
                                          ...prev,
                                          [itemKey]: uid,
                                        }));
                                      }}
                                      className="select text-xs py-1 w-full"
                                    >
                                      <option value="">[ Unassigned ]</option>
                                      {filterPMTeamOnly ? (
                                        <>
                                          {selectedUserId &&
                                            !candidateEngineers.some((e) => e.id === selectedUserId) &&
                                            allEngineers.find((e) => e.id === selectedUserId) && (
                                              <option value={selectedUserId}>
                                                {formatName(allEngineers.find((e) => e.id === selectedUserId)!.fullName)} (
                                                {allEngineers.find((e) => e.id === selectedUserId)!.designation ||
                                                  allEngineers.find((e) => e.id === selectedUserId)!.grade}
                                                )
                                              </option>
                                            )}
                                          {candidateEngineers.map((eng) => (
                                            <option key={eng.id} value={eng.id}>
                                              {formatName(eng.fullName)} ({eng.designation || eng.grade})
                                            </option>
                                          ))}
                                        </>
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
                                    {rationaleInfo ? (
                                      <p
                                        className={clsx(
                                          'text-[10px] mt-0.5 truncate',
                                          rationaleInfo.isWeakMatch ? 'text-error' : 'text-success'
                                        )}
                                        title={rationaleInfo.rationale}
                                      >
                                        {rationaleInfo.rationale}
                                      </p>
                                    ) : null}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                );
              });
            })}
          </div>

          <div className="flex items-center justify-between border-t border-hairline pt-4">
            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              className="btn btn-secondary"
            >
              ← Back: Scope & PM
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn btn-primary px-6"
            >
              {isPending ? 'Creating Project...' : 'Create Project & Tasks'}
            </button>
          </div>
        </section>
      ) : null}
    </form>
  );
}
