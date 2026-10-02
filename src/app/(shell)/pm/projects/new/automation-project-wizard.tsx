'use client';

import { useState, useTransition, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { formatName, cleanTaskTitle } from '@/core/utils/strings';
import { addWorkingDays, formatDate, workingDaysBetween } from '@/core/utils/dates';
import { minWorkingDaysForHours, planLaneByHours } from '@/modules/project-management/domain/scheduling';
import { createAutomationProjectAction } from '@/app/actions/automation-project';
import { autoAssignAutomationTeamAction, createClientAction } from '@/app/actions/pm';

interface TemplateItem {
  id: string;
  stepNumber: number;
  code: string;
  title: string;
  recommendedSeniority: string;
  defaultDurationHours: number;
  dependsOnStep: number | null;
  isSimulationSignoff: boolean;
}

/** Planned hours for one step in a panel (standard template duration, no quantity multiplier). */
function stepHours(item: { defaultDurationHours: number }): number {
  return item.defaultDurationHours || 8;
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
  isPM?: boolean;
}

interface Manager {
  id: string;
  fullName: string;
  designation: string | null;
  grade: string;
}

interface ClientOption {
  id: string;
  name: string;
  refNumber: string;
}

interface ExistingProjectCodeOption {
  code: string;
  clientId: string | null;
}

export function AutomationProjectWizard({
  managers,
  teamsByPM,
  allEngineers,
  templates,
  initialClients = [],
  defaultClientRef = 'ACS-0001',
  existingProjectCodes = [],
}: {
  managers: Manager[];
  teamsByPM: Record<string, string[]>;
  allEngineers: Engineer[];
  templates: Template[];
  initialClients?: ClientOption[];
  defaultClientRef?: string;
  existingProjectCodes?: ExistingProjectCodeOption[];
}) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Step 1: Order details
  const [isServiceCall, setIsServiceCall] = useState(false);
  const [workOrderNo, setWorkOrderNo] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientRefNumber, setClientRefNumber] = useState('');
  const [endUserName, setEndUserName] = useState('');
  const [applicationName, setApplicationName] = useState('');
  const [code, setCode] = useState('');

  const suggestedCodes = useMemo(() => {
    const list = clientId
      ? existingProjectCodes.filter((item) => item.clientId === clientId)
      : existingProjectCodes;
    return Array.from(new Set(list.map((item) => item.code)));
  }, [clientId, existingProjectCodes]);

  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]!);
  const [targetEndDate, setTargetEndDate] = useState('');
  const [step1Error, setStep1Error] = useState<string | null>(null);

  // Clients & Inline client creation
  const [clients, setClients] = useState<ClientOption[]>(initialClients);
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientRef, setNewClientRef] = useState(defaultClientRef);
  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [clientModalError, setClientModalError] = useState<string | null>(null);

  // Step 2: Scope & PM selection
  const [selectedScopes, setSelectedScopes] = useState<Record<string, { enabled: boolean; qty: number }>>({
    PLC: { enabled: true, qty: 1 },
    SCADA: { enabled: false, qty: 1 },
    HMI: { enabled: false, qty: 1 },
  });
  const [selectedPMId, setSelectedPMId] = useState<string>('');
  const [step2Error, setStep2Error] = useState<string | null>(null);

  // Step 3: Team assignments & dates (One engineer per panel)
  // key: `${templateCode}_${unitIndex}` e.g. "PLC_1"
  const [taskAssignments, setTaskAssignments] = useState<Record<string, string>>({});
  const [panelDeliveryDates, setPanelDeliveryDates] = useState<Record<string, string>>({});
  const [rationales, setRationales] = useState<
    Record<string, { rationale: string; isWeakMatch: boolean; score: number }>
  >({});
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [autoAssignBanner, setAutoAssignBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(new Set());

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Handle client selection
  const handleClientSelect = (selectedId: string) => {
    setClientId(selectedId);
    const found = clients.find((c) => c.id === selectedId);
    if (found) {
      setClientName(found.name);
      setClientRefNumber(found.refNumber);
    } else {
      setClientName('');
      setClientRefNumber('');
    }
  };

  // Add new client inline
  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setClientModalError(null);
    const trimmedName = newClientName.trim();
    const trimmedRef = newClientRef.trim().toUpperCase();

    if (!trimmedName || trimmedName.length < 2) {
      setClientModalError('Client name must be at least 2 characters.');
      return;
    }
    if (!trimmedRef || !/^ACS-\d{4}$/.test(trimmedRef)) {
      setClientModalError('Client reference must follow format ACS-XXXX (e.g. ACS-0042).');
      return;
    }

    setIsCreatingClient(true);
    try {
      const res = await createClientAction(trimmedName, trimmedRef);
      if (res.success && res.client) {
        setClients((prev) => [...prev, res.client!]);
        setClientId(res.client.id);
        setClientName(res.client.name);
        setClientRefNumber(res.client.refNumber);
        setShowAddClient(false);
        setNewClientName('');
      } else {
        setClientModalError(res.error || 'Failed to create client.');
      }
    } catch (err: unknown) {
      setClientModalError(err instanceof Error ? err.message : 'Failed to create client.');
    } finally {
      setIsCreatingClient(false);
    }
  };

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
        qty: Math.max(1, Math.min(20, qty)),
      },
    }));
  };

  const togglePanelExpand = (panelKey: string) => {
    setExpandedPanels((prev) => {
      const next = new Set(prev);
      if (next.has(panelKey)) next.delete(panelKey);
      else next.add(panelKey);
      return next;
    });
  };

  // Active scopes list
  const activeScopes = useMemo(() => {
    return Object.entries(selectedScopes)
      .filter(([_, val]) => val.enabled && val.qty > 0)
      .map(([tCode, val]) => ({ templateCode: tCode, quantity: val.qty }));
  }, [selectedScopes]);

  // Panels list (parallel panel units)
  const panelsList = useMemo(() => {
    const list: Array<{
      panelKey: string;
      templateCode: string;
      unitIndex: number;
      title: string;
      template: Template;
      totalHours: number;
    }> = [];

    for (const scope of activeScopes) {
      const tpl = templates.find((t) => t.code === scope.templateCode);
      if (!tpl) continue;
      const totalHours = tpl.items.reduce((sum, item) => sum + stepHours(item), 0);
      for (let unit = 1; unit <= scope.quantity; unit++) {
        list.push({
          panelKey: `${scope.templateCode}_${unit}`,
          templateCode: scope.templateCode,
          unitIndex: unit,
          title: `${scope.templateCode} Panel ${unit}`,
          template: tpl,
          totalHours,
        });
      }
    }
    return list;
  }, [activeScopes, templates]);

  // Minimum required finish date computation (panels run in parallel, so max of single panels)
  const { minWorkingDays, minFinishDateStr, minFinishDateObj } = useMemo(() => {
    if (activeScopes.length === 0 || !startDate) {
      return { minWorkingDays: 13, minFinishDateStr: '', minFinishDateObj: new Date() };
    }
    const startDt = new Date(startDate);
    let maxDays = 0;
    for (const scope of activeScopes) {
      const tpl = templates.find((t) => t.code === scope.templateCode);
      if (!tpl) continue;
      // Per panel duration (1x template hours)
      const panelDays = minWorkingDaysForHours(tpl.items.map((item) => stepHours(item)));
      if (panelDays > maxDays) maxDays = panelDays;
    }
    const days = Math.max(1, maxDays);
    const finishObj = addWorkingDays(startDt, days - 1);
    const finishStr = finishObj.toISOString().split('T')[0];
    return { minWorkingDays: days, minFinishDateStr: finishStr, minFinishDateObj: finishObj };
  }, [activeScopes, templates, startDate]);

  // Pre-fill target delivery date if empty or if previously less than min
  useEffect(() => {
    if (!minFinishDateStr) return;
    if (!targetEndDate || targetEndDate < minFinishDateStr) {
      setTargetEndDate(minFinishDateStr);
    }
  }, [minFinishDateStr, targetEndDate]);

  // Check if chosen target end date is too early
  const selectedDurationWorkingDays = useMemo(() => {
    if (!startDate || !targetEndDate) return 0;
    return workingDaysBetween(new Date(startDate), new Date(targetEndDate));
  }, [startDate, targetEndDate]);

  const isTargetDateTooEarly = selectedDurationWorkingDays < minWorkingDays;

  // Planned dates per step inside a panel (1x template duration)
  const stepPlanMap = useMemo(() => {
    const map: Record<string, { plannedStart: string; plannedEnd: string; hours: number }> = {};
    if (!startDate) return map;
    const startDt = new Date(startDate);

    for (const panel of panelsList) {
      const deliveryDate = panelDeliveryDates[panel.panelKey] || targetEndDate;
      const availableDays = deliveryDate ? workingDaysBetween(startDt, new Date(deliveryDate)) : undefined;
      const hours = panel.template.items.map((item) => stepHours(item));
      const plan = planLaneByHours(hours, startDt, availableDays);
      panel.template.items.forEach((item, idx) => {
        map[`${panel.panelKey}_${item.stepNumber}`] = {
          plannedStart: plan[idx]!.plannedStart.toISOString().split('T')[0],
          plannedEnd: plan[idx]!.plannedEnd.toISOString().split('T')[0],
          hours: hours[idx]!,
        };
      });
    }
    return map;
  }, [startDate, targetEndDate, panelsList, panelDeliveryDates]);

  interface EngineerGroup {
    id: string;
    label: string;
    engineers: Engineer[];
  }

  // Engineers grouped by PM squad, selected PM's team first and marked
  const engineerGroups = useMemo<EngineerGroup[]>(() => {
    const usedIds = new Set<string>();
    const groups: EngineerGroup[] = [];

    // 1. Selected PM's team first (marked with "(PM)")
    if (selectedPMId) {
      const selectedManager = managers.find((m) => m.id === selectedPMId);
      const teamUserIds = new Set(teamsByPM[selectedPMId] || []);
      const ownEngineers = allEngineers.filter(
        (e) => (teamUserIds.has(e.id) || e.id === selectedPMId) && !usedIds.has(e.id),
      );
      ownEngineers.sort((a, b) => {
        if (a.id === selectedPMId) return -1;
        if (b.id === selectedPMId) return 1;
        return 0;
      });
      for (const e of ownEngineers) usedIds.add(e.id);

      const managerName = selectedManager ? formatName(selectedManager.fullName) : 'Selected PM';
      groups.push({
        id: selectedPMId,
        label: `${managerName}'s team (PM)`,
        engineers: ownEngineers,
      });
    }

    // 2. Each other PM's team
    for (const m of managers) {
      if (m.id === selectedPMId) continue;
      const teamUserIds = new Set(teamsByPM[m.id] || []);
      const teamEngineers = allEngineers.filter(
        (e) => (teamUserIds.has(e.id) || e.id === m.id) && !usedIds.has(e.id),
      );
      teamEngineers.sort((a, b) => {
        if (a.id === m.id) return -1;
        if (b.id === m.id) return 1;
        return 0;
      });
      for (const e of teamEngineers) usedIds.add(e.id);

      if (teamEngineers.length > 0) {
        groups.push({
          id: m.id,
          label: `${formatName(m.fullName)}'s team`,
          engineers: teamEngineers,
        });
      }
    }

    // 3. "Other engineers" for anyone in no PM team
    const remaining = allEngineers.filter((e) => !usedIds.has(e.id));
    if (remaining.length > 0) {
      groups.push({
        id: 'other',
        label: 'Other engineers',
        engineers: remaining,
      });
    }

    return groups;
  }, [selectedPMId, managers, teamsByPM, allEngineers]);

  // Auto-assign team to panels
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
        templateCode: string;
        unitIndex: number;
        stepNumber: number;
        title: string;
        recommendedSeniority: string;
        plannedStart: string;
        plannedEnd: string;
        estimatedHours: number;
      }> = [];

      for (const scope of activeScopes) {
        const tpl = templates.find((t) => t.code === scope.templateCode);
        if (!tpl) continue;
        for (let unit = 1; unit <= scope.quantity; unit++) {
          for (const item of tpl.items) {
            const plan = stepPlanMap[`${scope.templateCode}_${unit}_${item.stepNumber}`];
            if (!plan) continue;
            tasksPayload.push({
              templateCode: scope.templateCode,
              unitIndex: unit,
              stepNumber: item.stepNumber,
              title: `${item.title} (${scope.templateCode} Panel ${unit})`,
              recommendedSeniority: item.recommendedSeniority,
              plannedStart: plan.plannedStart,
              plannedEnd: plan.plannedEnd,
              estimatedHours: plan.hours,
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
        scopes: activeScopes,
        tasks: tasksPayload,
      });

      if (res.success && res.assignments) {
        const newAssignments = { ...taskAssignments };
        const newRationales: Record<string, { rationale: string; isWeakMatch: boolean; score: number }> = {};

        for (const a of res.assignments) {
          if (a.assignedUserId) {
            newAssignments[a.stepId] = a.assignedUserId;
          }
          if (a.rationale) {
            newRationales[a.stepId] = {
              rationale: a.rationale,
              isWeakMatch: Boolean(a.isWeakMatch),
              score: a.score,
            };
          }
        }

        setTaskAssignments(newAssignments);
        setRationales(newRationales);
        setAutoAssignBanner({
          type: 'success',
          message: `Auto-assigned engineers for ${res.assignments.length} panels based on workload and skills.`,
        });
      } else {
        setAutoAssignBanner({
          type: 'error',
          message: res.error || 'Failed to auto-assign engineers.',
        });
      }
    } catch {
      setAutoAssignBanner({
        type: 'error',
        message: 'An error occurred during auto-assignment.',
      });
    } finally {
      setIsAutoAssigning(false);
    }
  }, [selectedPMId, startDate, targetEndDate, activeScopes, templates, stepPlanMap, taskAssignments]);

  // Step 1 validation
  const handleProceedToStep2 = () => {
    setStep1Error(null);
    if (!isServiceCall) {
      if (!workOrderNo.trim()) {
        setStep1Error('Work Order No. is required.');
        return;
      }
      if (!/^\d+$/.test(workOrderNo.trim())) {
        setStep1Error('Work Order No. must contain digits only.');
        return;
      }
    }
    if (!clientId) {
      setStep1Error('Please select a client.');
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
    if (isTargetDateTooEarly) {
      setStep1Error(`Needs at least ${minWorkingDays} working days (finishes ${formatDate(minFinishDateObj)}).`);
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
    if (isTargetDateTooEarly) {
      setStep2Error(`Needs at least ${minWorkingDays} working days (finishes ${formatDate(minFinishDateObj)}). Please adjust target delivery date in Step 1.`);
      return;
    }
    setCurrentStep(3);

    // Auto-assign on first entry to step 3 if empty
    if (Object.keys(taskAssignments).length === 0) {
      setTimeout(() => {
        handleAutoAssign();
      }, 50);
    }
  };

  const unassignedPanels = useMemo(
    () => panelsList.filter((panel) => !taskAssignments[panel.panelKey]).map((panel) => panel.title),
    [panelsList, taskAssignments],
  );

  // Submit Handler
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if ((!isServiceCall && !workOrderNo.trim()) || !clientId || !selectedPMId) {
      setError(
        isServiceCall
          ? 'Please select a Client and choose a Project Manager.'
          : 'Please fill in Work Order No, select a Client, and choose a Project Manager.'
      );
      return;
    }

    if (activeScopes.length === 0) {
      setError('Please select at least one automation scope package.');
      return;
    }

    if (isTargetDateTooEarly) {
      setError(`Needs at least ${minWorkingDays} working days (finishes ${formatDate(minFinishDateObj)}).`);
      return;
    }

    if (unassignedPanels.length > 0) {
      setError(`Assign an engineer to every panel. Still unassigned: ${unassignedPanels.join(', ')}.`);
      return;
    }

    // Check per-panel delivery dates
    for (const panel of panelsList) {
      const pDelivery = panelDeliveryDates[panel.panelKey] || targetEndDate;
      const pMinDays = minWorkingDaysForHours(panel.template.items.map((item) => stepHours(item)));
      const pDays = startDate && pDelivery ? workingDaysBetween(new Date(startDate), new Date(pDelivery)) : 0;
      const pFinish = startDate ? addWorkingDays(new Date(startDate), pMinDays - 1) : new Date();

      if (pDays < pMinDays) {
        setError(`${panel.title} needs at least ${pMinDays} working days (finishes ${formatDate(pFinish)}).`);
        return;
      }
      if (startDate && pDelivery < startDate) {
        setError(`${panel.title} delivery date cannot be before the start date.`);
        return;
      }
      if (targetEndDate && pDelivery > targetEndDate) {
        setError(`${panel.title} delivery date cannot be after the project target date.`);
        return;
      }
    }

    // Build tasks payload: fans out panel's assigned engineer to all 13 steps of that panel
    const tasksPayload: Array<{
      templateCode: string;
      unitIndex: number;
      stepNumber: number;
      title: string;
      assigneeId?: string;
      plannedStart: string;
      plannedEnd: string;
      estimatedHours: number;
    }> = [];

    const finalPanelDeliveryDates: Record<string, string> = {};

    for (const scope of activeScopes) {
      const tpl = templates.find((t) => t.code === scope.templateCode);
      if (!tpl) continue;
      for (let unit = 1; unit <= scope.quantity; unit++) {
        const panelKey = `${scope.templateCode}_${unit}`;
        const panelAssigneeId = taskAssignments[panelKey] || undefined;
        finalPanelDeliveryDates[panelKey] = panelDeliveryDates[panelKey] || targetEndDate;

        for (const item of tpl.items) {
          const plan = stepPlanMap[`${panelKey}_${item.stepNumber}`];
          if (!plan) continue;
          tasksPayload.push({
            templateCode: scope.templateCode,
            unitIndex: unit,
            stepNumber: item.stepNumber,
            title: item.title,
            assigneeId: panelAssigneeId,
            plannedStart: plan.plannedStart,
            plannedEnd: plan.plannedEnd,
            estimatedHours: plan.hours,
          });
        }
      }
    }

    startTransition(async () => {
      const res = await createAutomationProjectAction({
        kind: isServiceCall ? 'SERVICE_CALL' : 'WORK_ORDER',
        name: isServiceCall ? undefined : `WO ${workOrderNo.trim()}`,
        workOrderNo: isServiceCall ? (workOrderNo.trim() || undefined) : workOrderNo.trim(),
        clientId,
        clientName: clientName.trim(),
        clientRefNumber: clientRefNumber.trim() || undefined,
        code: code.trim() || undefined,
        endUserName: endUserName.trim() || undefined,
        applicationName: applicationName.trim() || undefined,
        startDate,
        targetEndDate,
        managerId: selectedPMId,
        scopes: activeScopes,
        tasks: tasksPayload,
        panelDeliveryDates: finalPanelDeliveryDates,
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
              if (currentStep > 2) setCurrentStep(2);
            }}
            className={clsx(
              'flex items-center gap-2 text-xs sm:text-body-sm font-semibold transition-colors',
              currentStep === 2
                ? 'text-ink'
                : currentStep > 2
                ? 'text-muted hover:text-ink'
                : 'text-muted/60 cursor-not-allowed'
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
              if (currentStep === 3) setCurrentStep(3);
            }}
            className={clsx(
              'flex items-center gap-2 text-xs sm:text-body-sm font-semibold transition-colors',
              currentStep === 3 ? 'text-ink' : 'text-muted/60 cursor-not-allowed'
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
            <span>Review Panels & Team</span>
          </button>
        </div>
      </nav>

      {/* Global Error Banner */}
      {error ? (
        <div className="rounded-md border border-error/30 bg-error/[0.04] p-3 text-caption text-error">
          {error}
        </div>
      ) : null}

      {/* STEP 1: ORDER DETAILS */}
      {currentStep === 1 ? (
        <section className="card p-5 space-y-6 bg-surface">
          <div>
            <h2 className="text-title-sm font-semibold text-ink">1. Order & Customer Details</h2>
          </div>

          {step1Error ? (
            <div className="rounded-md border border-error/30 bg-error/[0.04] p-3 text-caption text-error">
              {step1Error}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Service Call / Work Order Toggle */}
            <div className="sm:col-span-2 flex items-center justify-between p-3.5 rounded-lg border border-hairline bg-surface-strong/20">
              <div>
                <p className="text-body-sm font-semibold text-ink">Urgent service call (no WO)</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isServiceCall}
                  onChange={(e) => {
                    setIsServiceCall(e.target.checked);
                    if (e.target.checked) setWorkOrderNo('');
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-strong peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            {/* Work Order No. (Digits Only) or Service Call Notice */}
            {!isServiceCall ? (
              <div>
                <label className="label text-xs font-semibold" htmlFor="workOrderNo">
                  Work Order No. *
                </label>
                <input
                  id="workOrderNo"
                  type="text"
                  pattern="\d+"
                  inputMode="numeric"
                  value={workOrderNo}
                  onChange={(e) => setWorkOrderNo(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 1042"
                  className="input text-sm w-full font-mono"
                  required
                />
                <span className="text-[11px] text-muted">Digits only, unique across all projects.</span>
              </div>
            ) : (
              <div className="flex flex-col justify-center rounded border border-dashed border-hairline p-3 bg-surface-strong/10">
                <span className="text-xs font-semibold text-ink">Project Identifier: Service Call</span>
                <span className="text-[11px] text-muted mt-0.5">
                  Named automatically as SC &lt;Client&gt; &lt;Date&gt;. A WO can be attached later once received.
                </span>
              </div>
            )}

            {/* Client Select & Add Client */}
            <div>
              <div className="flex items-center justify-between">
                <label className="label text-xs font-semibold" htmlFor="clientId">
                  Client / Customer *
                </label>
                <button
                  type="button"
                  onClick={() => setShowAddClient(true)}
                  className="text-xs text-primary font-semibold hover:underline"
                >
                  ➕ Add new client
                </button>
              </div>
              <select
                id="clientId"
                value={clientId}
                onChange={(e) => handleClientSelect(e.target.value)}
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

            {/* Client Reference No. (Read-only) */}
            <div>
              <label className="label text-xs font-semibold" htmlFor="clientRefNumber">
                Client Reference No.
              </label>
              <input
                id="clientRefNumber"
                type="text"
                value={clientRefNumber}
                readOnly
                placeholder="Autofilled from client selection"
                className="input text-sm w-full font-mono bg-surface-strong/30 cursor-not-allowed text-muted"
              />
              <span className="text-[11px] text-muted">Used to generate project code (e.g. {clientRefNumber || 'ACS-XXXX'}-0001).</span>
            </div>

            {/* Project Code (Optional override - pick or type) */}
            <div>
              <label className="label text-xs font-semibold" htmlFor="code">
                Project code (optional)
              </label>
              <input
                id="code"
                list="existing-project-codes"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={20}
                placeholder="Auto-generated if blank"
                className="input text-sm w-full font-mono"
              />
              <datalist id="existing-project-codes">
                {suggestedCodes.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            {/* End User Name */}
            <div>
              <label className="label text-xs font-semibold" htmlFor="endUserName">
                End User Name
              </label>
              <input
                id="endUserName"
                type="text"
                value={endUserName}
                onChange={(e) => setEndUserName(e.target.value)}
                placeholder="e.g. Mithapur Plant Unit 2"
                className="input text-sm w-full"
              />
            </div>

            {/* Application Name */}
            <div>
              <label className="label text-xs font-semibold" htmlFor="applicationName">
                Application Name
              </label>
              <input
                id="applicationName"
                type="text"
                value={applicationName}
                onChange={(e) => setApplicationName(e.target.value)}
                placeholder="e.g. Baking Soda Batch Reactor Control"
                className="input text-sm w-full"
              />
            </div>

            {/* Project Start Date */}
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

            {/* Target Delivery Date */}
            <div>
              <div className="flex items-center justify-between">
                <label className="label text-xs font-semibold" htmlFor="targetEndDate">
                  Target Delivery Date *
                </label>
                {minFinishDateStr ? (
                  <span className="text-[11px] font-mono text-muted">
                    Min required: {formatDate(minFinishDateObj)} ({minWorkingDays} working days)
                  </span>
                ) : null}
              </div>
              <input
                id="targetEndDate"
                type="date"
                value={targetEndDate}
                onChange={(e) => setTargetEndDate(e.target.value)}
                min={minFinishDateStr || undefined}
                className={clsx(
                  'input text-sm w-full font-mono',
                  isTargetDateTooEarly && 'border-error text-error'
                )}
                required
              />
              {isTargetDateTooEarly ? (
                <p className="mt-1 text-[11px] text-error">
                  Target date allows {selectedDurationWorkingDays} working days, but parallel panels require at least {minWorkingDays} working days.
                </p>
              ) : null}
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

      {/* Add Client Inline Modal */}
      {showAddClient ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 text-left">
          <div className="card w-full max-w-md bg-surface border border-hairline shadow-xl">
            <header className="card-header border-b border-hairline pb-3 flex justify-between items-center">
              <h3 className="card-title text-base font-semibold text-ink">Add New Client</h3>
              <button
                type="button"
                onClick={() => setShowAddClient(false)}
                className="text-muted hover:text-ink font-bold text-lg p-1"
              >
                &times;
              </button>
            </header>
            {/*
              NOT a <form>. This dialog renders inside the wizard's own <form>, and nested
              forms are invalid HTML: the browser discards the inner one, so its onSubmit
              never fires and the click bubbles to the wizard form instead, which does a
              native GET. That silently did nothing - no request, no error, no client.
              Keep this a <div> and submit from the button's onClick.
            */}
            <div className="card-body space-y-4 pt-4">
              <div>
                <label className="label text-xs font-semibold">Client Name *</label>
                <input
                  type="text"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleCreateClient(e);
                    }
                  }}
                  placeholder="e.g. Reliance Industries Ltd"
                  className="input text-sm w-full"
                  required
                />
              </div>
              <div>
                <label className="label text-xs font-semibold">Client Reference Number *</label>
                <input
                  type="text"
                  value={newClientRef}
                  onChange={(e) => setNewClientRef(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleCreateClient(e);
                    }
                  }}
                  placeholder="e.g. ACS-0042"
                  pattern="ACS-\d{4}"
                  className="input text-sm w-full font-mono uppercase"
                  required
                />
                <span className="text-[11px] text-muted">Format: ACS-XXXX (e.g. ACS-0042)</span>
              </div>

              {clientModalError ? (
                <div className="rounded border border-error/30 bg-error/[0.04] p-2 text-caption text-error">
                  {clientModalError}
                </div>
              ) : null}

              <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
                <button
                  type="button"
                  onClick={() => setShowAddClient(false)}
                  className="btn btn-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateClient}
                  disabled={isCreatingClient}
                  className="btn btn-primary text-sm"
                >
                  {isCreatingClient ? 'Saving...' : 'Save Client'}
                </button>
              </div>
            </div>
          </div>
        </div>
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
              Automation Deliverables & Panel Quantities *
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
                        13 steps
                      </span>
                    </div>

                    <p className="text-caption text-muted line-clamp-2">
                      {tpl.description || `Standard ${tpl.name} pipeline.`}
                    </p>

                    {scope.enabled ? (
                      <div className="flex items-center justify-between border-t border-hairline pt-2.5">
                        <div className="flex flex-col">
                          <span className="text-caption text-muted">Panel Qty:</span>
                          <span className="text-[10px] text-muted font-mono font-medium">
                            13 days/panel (parallel)
                          </span>
                        </div>
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
                            disabled={scope.qty >= 20}
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
                Designated Project Manager / Asst. Manager *
              </label>
              <select
                id="managerId"
                value={selectedPMId}
                onChange={(e) => setSelectedPMId(e.target.value)}
                className="select text-sm w-full font-medium"
                required
              >
                <option value="">[ Choose Project Manager ]</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatName(m.fullName)} ({m.designation || 'Project Manager'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-hairline pt-4">
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="btn btn-secondary"
            >
              ← Back to Order
            </button>
            <button
              type="button"
              onClick={handleProceedToStep3}
              className="btn btn-primary"
            >
              Next: Review Panels & Team →
            </button>
          </div>
        </section>
      ) : null}

      {/* STEP 3: REVIEW PANELS & TEAM */}
      {currentStep === 3 ? (
        <section className="card p-5 space-y-6 bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-title-sm font-semibold text-ink">3. Review Panels & Assign Engineers</h2>
              <p className="text-caption text-muted">
                Each panel runs in parallel with its own assigned engineer. Expand any panel to inspect the 13 sequential steps and dates.
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

          {/* Panels List */}
          <div className="space-y-3">
            {panelsList.map((panel) => {
              const isExpanded = expandedPanels.has(panel.panelKey);
              const assignedId = taskAssignments[panel.panelKey] || '';
              const rationale = rationales[panel.panelKey];
              const panelDeliveryDate = panelDeliveryDates[panel.panelKey] || targetEndDate || '';
              const panelMinDays = minWorkingDaysForHours(panel.template.items.map((item) => stepHours(item)));
              const panelDays = startDate && panelDeliveryDate ? workingDaysBetween(new Date(startDate), new Date(panelDeliveryDate)) : 0;
              const isPanelEarly = panelDays < panelMinDays;
              const panelMinFinishObj = startDate ? addWorkingDays(new Date(startDate), panelMinDays - 1) : null;

              return (
                <div
                  key={panel.panelKey}
                  className="rounded-lg border border-hairline bg-canvas overflow-hidden divide-y divide-hairline"
                >
                  {/* Panel Row */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => togglePanelExpand(panel.panelKey)}
                        className="flex h-7 w-7 items-center justify-center rounded bg-surface-strong text-xs font-mono font-bold text-ink hover:bg-surface-strong/80"
                      >
                        {isExpanded ? '▼' : '▸'}
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-ink text-body-sm">{panel.title}</span>
                          <span className="badge bg-surface-strong text-caption text-muted font-mono">
                            13 steps · {panel.totalHours}h
                          </span>
                        </div>
                        <p className="text-caption text-muted font-mono">
                          {formatDate(startDate)} → {formatDate(panelDeliveryDate)}
                        </p>
                        {isPanelEarly && panelMinFinishObj ? (
                          <p className="text-[11px] text-error font-medium mt-0.5">
                            Min required: {panelMinDays} working days (finishes {formatDate(panelMinFinishObj)})
                          </p>
                        ) : null}
                        {rationale ? (
                          <p className="text-[11px] text-primary mt-0.5">{rationale.rationale}</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <label
                          htmlFor={`delivery-${panel.panelKey}`}
                          className="text-caption text-muted font-medium whitespace-nowrap"
                        >
                          Delivery:
                        </label>
                        <input
                          id={`delivery-${panel.panelKey}`}
                          type="date"
                          value={panelDeliveryDate}
                          min={startDate}
                          max={targetEndDate}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPanelDeliveryDates((prev) => ({
                              ...prev,
                              [panel.panelKey]: val,
                            }));
                          }}
                          className={clsx(
                            'input text-xs py-1 px-2 font-mono w-36',
                            isPanelEarly && 'border-error text-error'
                          )}
                        />
                      </div>

                      <div className="w-56">
                        <select
                          value={assignedId}
                          onChange={(e) =>
                            setTaskAssignments((prev) => ({
                              ...prev,
                              [panel.panelKey]: e.target.value,
                            }))
                          }
                          className="select text-xs w-full font-medium"
                        >
                          <option value="">[ Choose Engineer ]</option>
                          {engineerGroups.map((group) => (
                            <optgroup key={group.id} label={group.label}>
                              {group.engineers.map((eng) => (
                                <option key={eng.id} value={eng.id}>
                                  {formatName(eng.fullName)} {eng.isPM ? '(PM)' : `(${eng.grade.replaceAll('_', ' ')})`}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={() => togglePanelExpand(panel.panelKey)}
                        className="btn btn-secondary btn-sm text-xs font-medium"
                      >
                        {isExpanded ? 'Hide steps' : 'Inspect steps'}
                      </button>
                    </div>
                  </div>

                  {/* Read-only steps inspection table when expanded */}
                  {isExpanded ? (
                    <div className="overflow-x-auto p-3 bg-surface">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-hairline text-caption font-semibold text-muted">
                          <tr>
                            <th className="py-2 px-2 w-12">#</th>
                            <th className="py-2 px-2">Task Step</th>
                            <th className="py-2 px-2 w-28">Seniority</th>
                            <th className="py-2 px-2 w-24">Hours</th>
                            <th className="py-2 px-2 w-48">Planned Dates</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                          {panel.template.items.map((item) => {
                            const plan = stepPlanMap[`${panel.panelKey}_${item.stepNumber}`];
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
                                <td className="py-2 px-2 font-mono text-muted">
                                  {item.defaultDurationHours} h
                                </td>
                                <td className="py-2 px-2 font-mono text-muted">
                                  {plan ? `${plan.plannedStart} → ${plan.plannedEnd}` : '—'}
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
            })}
          </div>

          <div className="flex items-center justify-between border-t border-hairline pt-4">
            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              className="btn btn-secondary"
            >
              ← Back to Scope
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn btn-primary"
            >
              {isPending ? 'Creating Project & WBS...' : 'Create Automation Project ✓'}
            </button>
          </div>
        </section>
      ) : null}
    </form>
  );
}
