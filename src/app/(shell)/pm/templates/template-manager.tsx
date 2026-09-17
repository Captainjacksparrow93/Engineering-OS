'use client';

import { useState, useTransition } from 'react';
import { updateTemplateItemAction, addTemplateItemAction, deleteTemplateItemAction } from '@/app/actions/template';
import { useToast } from '@/components/toast';
import { ConfirmDialog } from '@/components/confirm-dialog';

interface Item {
  id: string;
  templateId: string;
  stepNumber: number;
  code: string;
  title: string;
  description: string | null;
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
  items: Item[];
}

const SENIORITY_LABELS: Record<string, string> = {
  ASST_MANAGER: 'Asst. Manager',
  SENIOR: 'Sr. Engineer',
  JUNIOR: 'Jr. Engineer',
  TRAINEE: 'Trainee Engineer',
};

export function TemplateManagerClient({ templates }: { templates: Template[] }) {
  const [activeCode, setActiveCode] = useState(templates[0]?.code ?? 'PLC');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSeniority, setEditSeniority] = useState('JUNIOR');
  const [editDuration, setEditDuration] = useState(1);
  const [editDepends, setEditDepends] = useState<number | null>(null);

  const [newTitle, setNewTitle] = useState('');
  const [newSeniority, setNewSeniority] = useState('JUNIOR');

  const [showAddModal, setShowAddModal] = useState(false);
  const [deletingItem, setDeletingItem] = useState<{ id: string; title: string; stepNumber: number } | null>(null);

  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const activeTemplate = templates.find((t) => t.code === activeCode) ?? templates[0];

  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditSeniority(item.recommendedSeniority);
    setEditDuration(item.defaultDurationDays);
    setEditDepends(item.dependsOnStep);
  };

  const handleSaveEdit = (itemId: string) => {
    startTransition(async () => {
      const res = await updateTemplateItemAction(itemId, {
        title: editTitle,
        recommendedSeniority: editSeniority,
        defaultDurationDays: Number(editDuration),
        dependsOnStep: editDepends !== null ? Number(editDepends) : null,
      });
      if (res.success) {
        setEditingId(null);
        toast.success('Step updated successfully.');
      } else {
        toast.error(res.error ?? 'Failed to update step');
      }
    });
  };

  const handleConfirmDelete = () => {
    if (!deletingItem) return;
    startTransition(async () => {
      const res = await deleteTemplateItemAction(deletingItem.id);
      if (res.success) {
        toast.success(`Step ${deletingItem.stepNumber} deleted successfully.`);
        setDeletingItem(null);
      } else {
        toast.error(res.error ?? 'Failed to delete step');
      }
    });
  };

  const handleAddSubtask = () => {
    if (!activeTemplate || !newTitle.trim()) return;
    startTransition(async () => {
      const res = await addTemplateItemAction(activeTemplate.id, {
        title: newTitle.trim(),
        recommendedSeniority: newSeniority,
        defaultDurationDays: 1,
      });
      if (res.success) {
        setShowAddModal(false);
        setNewTitle('');
        toast.success('New step added to checklist.');
      } else {
        toast.error(res.error ?? 'Failed to add step');
      }
    });
  };

  return (
    <div className="space-y-6">

      {/* Package Tabs */}
      <div className="flex border-b border-hairline gap-2">
        {templates.map((t) => (
          <button
            key={t.code}
            onClick={() => { setActiveCode(t.code); setEditingId(null); }}
            className={`pb-3 px-4 font-medium text-sm transition-colors border-b-2 ${
              activeCode === t.code
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.name} ({t.items.length} steps)
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-header flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="card-title text-base font-semibold">{activeTemplate?.name}</h3>
            <p className="text-caption text-muted mt-0.5">{activeTemplate?.description}</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-primary btn-sm flex items-center gap-1.5"
          >
            <span>+ Add Subtask</span>
          </button>
        </div>

        <div className="p-0 overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr className="bg-surface-subtle text-left text-xs font-semibold text-muted uppercase tracking-wider">
                <th className="w-16 text-center">Step</th>
                <th>Standard Task Title</th>
                <th className="w-36">Recommended Seniority</th>

                <th className="w-32">Blocker (Depends)</th>
                <th className="w-28 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {activeTemplate?.items.map((item) => {
                const isEditing = editingId === item.id;
                return (
                  <tr key={item.id} className={isEditing ? 'bg-amber-50/40' : 'hover:bg-surface-subtle/50'}>
                    <td className="text-center font-semibold text-sm text-muted">
                      {item.stepNumber}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="input text-sm w-full"
                          autoFocus
                        />
                      ) : (
                        <div>
                          <p className="font-medium text-ink text-sm inline-flex items-center gap-2">
                            <span>{item.title}</span>
                            {item.isSimulationSignoff && (
                              <span className="badge badge-neutral text-xs">Sign-off Gate</span>
                            )}
                          </p>
                        </div>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <select
                          value={editSeniority}
                          onChange={(e) => setEditSeniority(e.target.value)}
                          className="select text-xs py-1"
                        >
                          <option value="ASST_MANAGER">Asst. Manager</option>
                          <option value="SENIOR">Sr. Engineer</option>
                          <option value="JUNIOR">Jr. Engineer</option>
                          <option value="TRAINEE">Trainee Engineer</option>
                        </select>
                      ) : (
                        <span className="badge badge-neutral text-xs">
                          {SENIORITY_LABELS[item.recommendedSeniority] ?? item.recommendedSeniority}
                        </span>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <select
                          value={editDepends ?? ''}
                          onChange={(e) => setEditDepends(e.target.value ? Number(e.target.value) : null)}
                          className="select text-xs py-1"
                        >
                          <option value="">None (Can start immediately)</option>
                          {activeTemplate.items
                            .filter((other) => other.stepNumber < item.stepNumber)
                            .map((other) => (
                              <option key={other.stepNumber} value={other.stepNumber}>
                                Step {other.stepNumber} ({other.title.slice(0, 20)}...)
                              </option>
                            ))}
                        </select>
                      ) : item.dependsOnStep ? (
                        <span className="badge bg-error/10 text-error text-xs font-mono">
                          Blocked by Step {item.dependsOnStep}
                        </span>
                      ) : (
                        <span className="text-caption text-muted italic">None (Start)</span>
                      )}
                    </td>
                    <td className="text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleSaveEdit(item.id)}
                            disabled={isPending}
                            className="btn btn-primary btn-xs"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            disabled={isPending}
                            className="btn btn-secondary btn-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => startEdit(item)}
                            className="text-xs text-primary hover:underline font-medium"
                          >
                            Edit
                          </button>
                          <span className="text-muted-soft">|</span>
                          <button
                            onClick={() => setDeletingItem({ id: item.id, title: item.title, stepNumber: item.stepNumber })}
                            className="text-xs text-error hover:underline font-medium"
                          >
                            Delete
                          </button>
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

      {/* Add Subtask Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="card w-full max-w-lg bg-surface animate-in fade-in zoom-in-95">
            <header className="card-header flex items-center justify-between border-b border-hairline pb-3">
              <h3 className="card-title text-base font-semibold">Add Subtask to {activeTemplate?.name}</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-muted hover:text-ink text-lg font-bold"
              >
                &times;
              </button>
            </header>
            <div className="card-body space-y-4 pt-4">
              <div>
                <label className="label text-xs font-medium">Task Title *</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Safety Interlock Testing"
                  className="input text-sm w-full"
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <label className="label text-xs font-medium">Recommended Seniority</label>
                  <select
                    value={newSeniority}
                    onChange={(e) => setNewSeniority(e.target.value)}
                    className="select text-sm w-full"
                  >
                    <option value="ASST_MANAGER">Asst. Manager</option>
                    <option value="SENIOR">Sr. Engineer</option>
                    <option value="JUNIOR">Jr. Engineer</option>
                    <option value="TRAINEE">Trainee Engineer</option>
                  </select>
                </div>
              </div>
            </div>
            <footer className="card-footer flex justify-end gap-2 border-t border-hairline pt-3 px-4 pb-4">
              <button
                onClick={() => setShowAddModal(false)}
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleAddSubtask}
                disabled={isPending || !newTitle.trim()}
                className="btn btn-primary btn-sm"
              >
                {isPending ? 'Adding...' : 'Add Subtask'}
              </button>
            </footer>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(deletingItem)}
        title={deletingItem ? `Delete step ${deletingItem.stepNumber}?` : 'Delete step?'}
        description={`Are you sure you want to delete "${deletingItem?.title}"? Later steps will be automatically renumbered and dependencies remapped.`}
        confirmLabel="Delete step"
        tone="danger"
        isPending={isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingItem(null)}
      />
    </div>
  );
}



