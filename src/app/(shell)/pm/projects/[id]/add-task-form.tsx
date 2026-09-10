'use client';

import { useActionState, useState } from 'react';
import { createTaskAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';

interface TaskOption {
  id: string;
  code: string;
  title: string;
  type: string;
}

interface PersonOption {
  id: string;
  fullName: string;
  designation?: string | null;
}

/**
 * Adding work to the WBS. Dependencies are picked here rather than in a separate step,
 * because a task created without its predecessors immediately shows up as "ready to
 * start" and someone begins work they cannot finish.
 */
export function AddTaskForm({
  projectId,
  tasks,
  people,
}: {
  projectId: string;
  tasks: TaskOption[];
  people: PersonOption[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(createTaskAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        + Add task to this project
      </button>
    );
  }

  return (
    <section className="card">
      <header className="card-header">
        <h2 className="card-title">Add task</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </header>
      <form action={action} className="card-body">
        <input type="hidden" name="projectId" value={projectId} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="field lg:col-span-2">
            <label className="label" htmlFor="title">Title *</label>
            <input id="title" name="title" required className="input" placeholder="e.g. Busbar sizing and short-circuit calculations" />
          </div>

          <div className="field">
            <label className="label" htmlFor="type">Type</label>
            <select id="type" name="type" className="select" defaultValue="PROJECT">
              <option value="PROJECT">Planned task</option>
              <option value="PHASE">Phase (container)</option>
              <option value="ADHOC">Ad-hoc</option>
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="parentId">Sits under</label>
            <select id="parentId" name="parentId" className="select" defaultValue="">
              <option value="">Top level</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.code} — {task.title}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="priority">Priority</label>
            <select id="priority" name="priority" className="select" defaultValue="MEDIUM">
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => (
                <option key={p} value={p}>{p.toLowerCase()}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="estimatedHours">Estimated hours</label>
            <input id="estimatedHours" name="estimatedHours" type="number" min="0.5" step="0.5" defaultValue={8} className="input" />
          </div>

          <div className="field">
            <label className="label" htmlFor="plannedStart">Planned start</label>
            <input id="plannedStart" name="plannedStart" type="date" className="input" />
          </div>

          <div className="field">
            <label className="label" htmlFor="plannedEnd">Planned finish</label>
            <input id="plannedEnd" name="plannedEnd" type="date" className="input" />
          </div>

          <div className="field">
            <label className="label" htmlFor="assigneeId">Assign to</label>
            <select id="assigneeId" name="assigneeId" className="select" defaultValue="">
              <option value="">Leave unassigned</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}{person.designation ? ` — ${person.designation}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="requiredSkills">Required skills</label>
            <input id="requiredSkills" name="requiredSkills" className="input" placeholder="schematics, EPLAN" />
            <p className="hint">Comma separated. Used to rank candidates.</p>
          </div>

          <div className="field sm:col-span-2 lg:col-span-3">
            <label className="label" htmlFor="description">Description</label>
            <textarea id="description" name="description" rows={2} className="textarea" />
          </div>

          <div className="field sm:col-span-2 lg:col-span-3">
            <label className="label" htmlFor="dependsOn">Cannot start until these finish</label>
            <select id="dependsOn" name="dependsOn" multiple size={Math.min(6, Math.max(3, tasks.length))} className="select h-auto">
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.code} — {task.title}
                </option>
              ))}
            </select>
            <p className="hint">Hold Ctrl/Cmd to pick several. Circular chains are rejected automatically.</p>
          </div>
        </div>

        <FormMessage state={state} />
        <div className="mt-3 flex gap-2">
          <SubmitButton pendingLabel="Creating…">Create task</SubmitButton>
        </div>
      </form>
    </section>
  );
}
