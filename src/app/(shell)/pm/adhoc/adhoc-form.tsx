'use client';

import { useActionState, useState } from 'react';
import { createTaskAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';
import { Avatar, StatusBadge } from '@/components/ui';
import { formatName } from '@/core/utils/strings';

interface Candidate {
  id: string;
  fullName: string;
  designation: string | null;
  departmentName: string | null;
  avatarColor: string;
  status: string;
  freeHours: number;
}

export function AdhocForm({
  projects,
  suggestions,
  defaultProjectId,
}: {
  projects: Array<{ id: string; code: string; name: string; clientName: string }>;
  suggestions: Candidate[];
  defaultProjectId?: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createTaskAction, {});
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');

  // Sort candidates by free hours descending
  const sorted = [...suggestions].sort((a, b) => b.freeHours - a.freeHours);
  const filtered = search
    ? sorted.filter(
        (c) =>
          c.fullName.toLowerCase().includes(search.toLowerCase()) ||
          (c.designation && c.designation.toLowerCase().includes(search.toLowerCase()))
      )
    : sorted;

  const selectedPerson = suggestions.find((s) => s.id === selected);

  return (
    <form action={action} className="grid gap-5 lg:grid-cols-5">
      <input type="hidden" name="type" value="ADHOC" />
      <input type="hidden" name="redirectTo" value="task" />
      <input type="hidden" name="assigneeId" value={selected} />
      <input type="hidden" name="priority" value="HIGH" />

      {/* The Work Details Form */}
      <div className="card h-fit lg:col-span-2">
        <header className="card-header">
          <h2 className="card-title">The work</h2>
          <span className="text-caption text-muted">Urgent assignment</span>
        </header>

        <div className="card-body space-y-4">
          <div className="field">
            <label className="label" htmlFor="projectId">Charge to project *</label>
            <select id="projectId" name="projectId" required className="select w-full" defaultValue={defaultProjectId ?? ''}>
              <option value="" disabled>Select a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="title">What needs doing? *</label>
            <input
              id="title"
              name="title"
              required
              className="input w-full"
              placeholder="e.g. Urgent motor feedback loop troubleshooting"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="estimatedHours">Hours needed</label>
              <input
                id="estimatedHours"
                name="estimatedHours"
                type="number"
                min="0.5"
                step="0.5"
                defaultValue={8}
                className="input w-full"
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="plannedEnd">Needed by</label>
              <input id="plannedEnd" name="plannedEnd" type="date" className="input w-full" />
            </div>
          </div>

          {/* Context box showing currently selected assignee */}
          <div className="rounded-lg border border-hairline bg-canvas-soft p-3">
            {selectedPerson ? (
              <div className="flex items-center gap-2.5">
                <Avatar name={selectedPerson.fullName} color={selectedPerson.avatarColor} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-medium text-ink">
                    Assigning to <strong>{formatName(selectedPerson.fullName)}</strong>
                  </p>
                  <p className="text-caption text-muted">{selectedPerson.freeHours}h free capacity</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected('')}
                  className="btn btn-secondary btn-sm"
                  title="Clear assignment"
                >
                  Clear
                </button>
              </div>
            ) : (
              <p className="text-caption text-muted">
                No assignee selected yet. Pick a candidate from the right, or create unassigned.
              </p>
            )}
          </div>

          <FormMessage state={state} />

          <SubmitButton variant="primary" className="w-full" pendingLabel="Creating task…">
            {selected ? 'Create and assign' : 'Create unassigned'}
          </SubmitButton>
        </div>
      </div>

      {/* Candidate List (No reload, client-side search, ranked by free hours) */}
      <div className="card h-fit lg:col-span-3">
        <header className="card-header flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="card-title">Who is free right now ({suggestions.length})</h2>
            <p className="text-caption text-muted">Ranked by available capacity</p>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search engineers…"
            className="input input-sm w-44"
          />
        </header>

        <div className="card-body max-h-[580px] space-y-2 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-body-sm text-muted p-4 text-center">No colleagues found matching "{search}".</p>
          ) : (
            filtered.map((person) => {
              const isSelected = selected === person.id;
              return (
                <label
                  key={person.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                    isSelected ? 'border-ink bg-canvas-soft ring-1 ring-ink' : 'border-hairline hover:bg-canvas-soft'
                  }`}
                >
                  <input
                    type="radio"
                    name="candidate"
                    className="accent-ink"
                    checked={isSelected}
                    onChange={() => setSelected(person.id)}
                  />
                  <Avatar name={person.fullName} color={person.avatarColor} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-body-sm font-semibold text-ink">
                        {formatName(person.fullName)}
                      </span>
                      <StatusBadge status={person.status} />
                    </div>
                    <p className="truncate text-caption text-muted">
                      {person.designation || 'Engineer'}
                      {person.departmentName ? ` · ${person.departmentName}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="inline-block rounded bg-surface-strong px-2 py-0.5 text-caption font-semibold text-ink">
                      {person.freeHours}h free
                    </span>
                  </div>
                </label>
              );
            })
          )}
        </div>
      </div>
    </form>
  );
}
