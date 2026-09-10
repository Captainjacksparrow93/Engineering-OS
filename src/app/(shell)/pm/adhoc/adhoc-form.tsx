'use client';

import { useActionState, useState } from 'react';
import { createTaskAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';
import { Avatar, ProgressBar, StatusBadge } from '@/components/ui';

interface Suggestion {
  id: string;
  fullName: string;
  designation: string | null;
  departmentName: string | null;
  avatarColor: string;
  score: number;
  skillMatch: number;
  status: string;
  freeHours: number;
  utilizationPercent: number;
  openTaskCount: number;
  reasons: string[];
}

export function AdhocForm({
  projects,
  departments,
  suggestions,
  filters,
}: {
  projects: Array<{ id: string; code: string; name: string; clientName: string }>;
  departments: Array<{ id: string; name: string }>;
  suggestions: Suggestion[];
  filters: { skills: string; hours: number; priority: string; departmentId: string; projectId: string };
}) {
  const [state, action] = useActionState<ActionState, FormData>(createTaskAction, {});
  const [selected, setSelected] = useState('');

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <form action={action} className="card lg:col-span-2 h-fit">
        <header className="card-header">
          <h2 className="card-title">The work</h2>
        </header>
        <div className="card-body">
          <input type="hidden" name="type" value="ADHOC" />
          <input type="hidden" name="redirectTo" value="task" />
          <input type="hidden" name="assigneeId" value={selected} />

          <div className="field">
            <label className="label" htmlFor="projectId">Charge to project *</label>
            <select id="projectId" name="projectId" required className="select" defaultValue={filters.projectId}>
              <option value="" disabled>Select</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} — {project.name}
                </option>
              ))}
            </select>
            <p className="hint">Keeps unplanned effort visible in project costing.</p>
          </div>

          <div className="field">
            <label className="label" htmlFor="title">What needs doing? *</label>
            <input id="title" name="title" required className="input" placeholder="e.g. Rework feeder 7 schematic after client comment" />
          </div>

          <div className="field">
            <label className="label" htmlFor="description">Context</label>
            <textarea id="description" name="description" rows={3} className="textarea" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="field">
              <label className="label" htmlFor="estimatedHours">Estimated hours</label>
              <input id="estimatedHours" name="estimatedHours" type="number" min="0.5" step="0.5" defaultValue={filters.hours} className="input" />
            </div>
            <div className="field">
              <label className="label" htmlFor="priority">Priority</label>
              <select id="priority" name="priority" className="select" defaultValue={filters.priority}>
                {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => (
                  <option key={p} value={p}>{p.toLowerCase()}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="plannedStart">Start</label>
              <input id="plannedStart" name="plannedStart" type="date" className="input" />
            </div>
            <div className="field">
              <label className="label" htmlFor="plannedEnd">Needed by</label>
              <input id="plannedEnd" name="plannedEnd" type="date" className="input" />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="requiredSkills">Skills required</label>
            <input id="requiredSkills" name="requiredSkills" defaultValue={filters.skills} className="input" placeholder="schematics, EPLAN" />
          </div>

          <div className="rounded-md border border-hairline bg-canvas-soft px-3 py-2 text-body-sm">
            {selected ? (
              <span className="text-ink">
                Assigning to <strong>{suggestions.find((s) => s.id === selected)?.fullName}</strong>
              </span>
            ) : (
              <span className="text-muted">Pick someone from the ranked list, or create it unassigned.</span>
            )}
          </div>

          <FormMessage state={state} />
          <div className="mt-3">
            <SubmitButton variant="primary" className="w-full" pendingLabel="Creating…">
              {selected ? 'Create and assign' : 'Create unassigned'}
            </SubmitButton>
          </div>
        </div>
      </form>

      <div className="lg:col-span-3">
        <form className="mb-3 flex flex-wrap items-end gap-2" action="/pm/adhoc">
          {filters.projectId ? <input type="hidden" name="projectId" value={filters.projectId} /> : null}
          <div>
            <label className="label" htmlFor="f-skills">Filter by skills</label>
            <input id="f-skills" name="skills" defaultValue={filters.skills} className="input w-52" placeholder="EPLAN, wiring" />
          </div>
          <div>
            <label className="label" htmlFor="f-hours">Hours needed</label>
            <input id="f-hours" name="hours" type="number" min="0" step="0.5" defaultValue={filters.hours} className="input w-28" />
          </div>
          <div>
            <label className="label" htmlFor="f-priority">Priority</label>
            <select id="f-priority" name="priority" defaultValue={filters.priority} className="select w-32">
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => (
                <option key={p} value={p}>{p.toLowerCase()}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-dept">Department</label>
            <select id="f-dept" name="departmentId" defaultValue={filters.departmentId} className="select w-44">
              <option value="">All in scope</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-secondary mb-0.5">Re-rank</button>
        </form>

        <section className="card">
          <header className="card-header">
            <h2 className="card-title">Who can take this ({suggestions.length})</h2>
            <span className="text-caption text-muted">Ranked by capacity, skills and grade</span>
          </header>
          <div className="card-body space-y-2">
            {suggestions.length === 0 ? (
              <p className="muted">
                Nobody is visible to you for these filters. Widen the department filter, or ask an administrator for
                broader resource visibility.
              </p>
            ) : (
              suggestions.slice(0, 12).map((suggestion) => (
                <label
                  key={suggestion.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                    selected === suggestion.id ? 'border-ink bg-canvas-soft' : 'border-hairline hover:bg-canvas-soft'
                  }`}
                >
                  <input
                    type="radio"
                    name="candidate"
                    className="mt-1 accent-ink"
                    checked={selected === suggestion.id}
                    onChange={() => setSelected(suggestion.id)}
                  />
                  <Avatar name={suggestion.fullName} color={suggestion.avatarColor} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body-sm font-semibold text-ink">{suggestion.fullName}</span>
                      <StatusBadge status={suggestion.status} />
                      <span className="ml-auto text-body-sm font-semibold text-ink">{suggestion.score}</span>
                    </div>
                    <p className="truncate text-caption text-muted">
                      {suggestion.designation ?? ''}
                      {suggestion.departmentName ? ` · ${suggestion.departmentName}` : ''}
                    </p>

                    <div className="mt-1.5">
                      <ProgressBar
                        value={Math.min(100, suggestion.utilizationPercent)}
                        tone={suggestion.utilizationPercent > 100 ? 'danger' : suggestion.utilizationPercent < 60 ? 'success' : 'default'}
                      />
                      <p className="mt-1 text-caption text-muted">
                        {suggestion.utilizationPercent}% loaded · {suggestion.freeHours}h free · {suggestion.openTaskCount} open tasks
                      </p>
                    </div>

                    {suggestion.reasons.length ? (
                      <p className="mt-1 text-caption text-muted">{suggestion.reasons.join(' · ')}</p>
                    ) : null}
                  </div>
                </label>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
