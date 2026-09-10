import Link from 'next/link';
import { getModule } from '@/core/modules/registry';
import { PageHeader } from '@/components/ui';

/**
 * Every module on the roadmap renders this instead of a half-built screen. It states
 * what the module will own and, crucially, how it will plug into what already exists -
 * so the integration story is visible to stakeholders from day one.
 */
export function ComingSoon({ moduleKey }: { moduleKey: string }) {
  const module = getModule(moduleKey);
  if (!module) return null;

  return (
    <>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        breadcrumb={[{ label: 'Modules', href: '/modules' }, { label: module.name }]}
      />

      <div className="mb-6 flex flex-col items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 sm:flex-row sm:items-center">
        <span className="text-3xl" aria-hidden>
          {module.icon}
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-900">Coming soon{module.plannedFor ? ` — ${module.plannedFor}` : ''}</p>
          <p className="mt-0.5 text-sm text-amber-800">
            This module is planned but not built yet. The platform, database and access control it needs are already in
            place, so it can be switched on without disturbing the modules you use today.
          </p>
        </div>
        <Link href="/pm/projects" className="btn btn-secondary">
          Back to projects
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <header className="card-header">
            <h2 className="card-title">What this module will cover</h2>
          </header>
          <div className="card-body">
            <ul className="space-y-2">
              {module.scope.map((item) => (
                <li key={item} className="flex gap-2 text-sm text-slate-600">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="card">
          <header className="card-header">
            <h2 className="card-title">How it connects to what exists</h2>
          </header>
          <div className="card-body space-y-3 text-sm text-slate-600">
            <p>
              All modules share one database, one employee record and one permission model. This module will add its own
              tables alongside the existing ones rather than duplicating people, departments or projects.
            </p>
            <p>
              Cross-module traffic runs over the platform event bus. Project Management already publishes events such as{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">pm.task.completed</code> and{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">pm.handover.accepted</code>, which this module
              will subscribe to on the day it ships.
            </p>
            <p>
              Access is already expressed as scoped permissions, so switching this module on is a matter of adding its
              permission keys to the catalogue and granting them - no rework of existing roles.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
