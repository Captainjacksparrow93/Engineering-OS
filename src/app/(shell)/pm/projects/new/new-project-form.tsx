'use client';

import { useActionState } from 'react';
import { createProjectAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';

interface Option {
  id: string;
  fullName?: string;
  name?: string;
  designation?: string | null;
  code?: string;
}

export function NewProjectForm({ managers, departments }: { managers: Option[]; departments: Option[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createProjectAction, {});

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-3">
      <section className="card lg:col-span-2">
        <header className="card-header">
          <h2 className="card-title">Order details</h2>
        </header>
        <div className="card-body grid gap-3 sm:grid-cols-2">
          <div className="field sm:col-span-2">
            <label className="label" htmlFor="name">Project name *</label>
            <input id="name" name="name" required className="input" placeholder="e.g. Tata Chemicals - MCC & PCC Panels" />
          </div>

          <div className="field">
            <label className="label" htmlFor="clientName">Client *</label>
            <input id="clientName" name="clientName" required className="input" />
          </div>

          <div className="field">
            <label className="label" htmlFor="code">Project code</label>
            <input id="code" name="code" className="input" placeholder="Auto-generated if left blank" />
          </div>

          <div className="field">
            <label className="label" htmlFor="poNumber">Customer PO number</label>
            <input id="poNumber" name="poNumber" className="input" />
          </div>

          <div className="field">
            <label className="label" htmlFor="orderValue">Order value (₹)</label>
            <input id="orderValue" name="orderValue" type="number" step="0.01" min="0" className="input" />
            <p className="hint">Moves to the ERP module when that goes live.</p>
          </div>

          <div className="field">
            <label className="label" htmlFor="panelType">Panel type / standard</label>
            <input id="panelType" name="panelType" className="input" placeholder="MCC + PCC, IP54, IEC 61439" />
          </div>

          <div className="field">
            <label className="label" htmlFor="panelCount">Number of panels</label>
            <input id="panelCount" name="panelCount" type="number" min="0" defaultValue={0} className="input" />
          </div>

          <div className="field sm:col-span-2">
            <label className="label" htmlFor="description">Scope of supply</label>
            <textarea id="description" name="description" rows={3} className="textarea" />
          </div>
        </div>
      </section>

      <section className="card h-fit">
        <header className="card-header">
          <h2 className="card-title">Ownership & schedule</h2>
        </header>
        <div className="card-body">
          <div className="field">
            <label className="label" htmlFor="managerId">Project manager *</label>
            <select id="managerId" name="managerId" required className="select" defaultValue="">
              <option value="" disabled>Select</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.fullName}{manager.designation ? ` — ${manager.designation}` : ''}
                </option>
              ))}
            </select>
            <p className="hint">They get project-scoped rights automatically.</p>
          </div>

          <div className="field">
            <label className="label" htmlFor="departmentId">Owning department</label>
            <select id="departmentId" name="departmentId" className="select" defaultValue="">
              <option value="">Manager&apos;s department</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
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
            <label className="label" htmlFor="status">Status</label>
            <select id="status" name="status" className="select" defaultValue="PLANNING">
              {['DRAFT', 'PLANNING', 'IN_PROGRESS'].map((s) => (
                <option key={s} value={s}>{s.replaceAll('_', ' ').toLowerCase()}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="startDate">Kick-off date</label>
            <input id="startDate" name="startDate" type="date" className="input" />
          </div>

          <div className="field">
            <label className="label" htmlFor="targetEndDate">Contractual delivery date</label>
            <input id="targetEndDate" name="targetEndDate" type="date" className="input" />
          </div>

          <FormMessage state={state} />
          <div className="mt-3">
            <SubmitButton variant="primary" className="w-full" pendingLabel="Creating…">Create project</SubmitButton>
          </div>
        </div>
      </section>
    </form>
  );
}
