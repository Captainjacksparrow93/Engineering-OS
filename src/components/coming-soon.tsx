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
        actions={
          <Link href="/pm/projects" className="btn btn-secondary">
            Back to projects
          </Link>
        }
      />

      <div className="mb-xl rounded-lg border border-hairline bg-canvas-soft px-lg py-md">
        <span className="badge badge-outline">Coming soon{module.plannedFor ? ` — ${module.plannedFor}` : ''}</span>
        <p className="mt-sm max-w-3xl text-body-md text-body">
          This module is planned but not built yet. The platform, database and access control it needs are already in
          place, so it can be switched on without disturbing the modules you use today.
        </p>
      </div>

      <div className="grid gap-base lg:grid-cols-2">
        <section className="card">
          <header className="card-header">
            <h2 className="card-title">What this module will cover</h2>
          </header>
          <div className="card-body">
            <ul className="space-y-sm">
              {module.scope.map((item) => (
                <li key={item} className="flex gap-sm text-body-sm text-body">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-pill bg-hairline-strong" />
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
          <div className="card-body space-y-sm text-body-sm text-body">
            <p>
              All modules share one database, one employee record and one permission model. This module will add its own
              tables alongside the existing ones rather than duplicating people, departments or projects.
            </p>
            <p>
              Cross-module traffic runs over the platform event bus. Project Management already publishes events such as{' '}
              <span className="code">pm.task.completed</span> and <span className="code">pm.handover.accepted</span>,
              which this module will subscribe to on the day it ships.
            </p>
            <p>
              Access is already expressed as scoped permissions, so switching this module on is a matter of adding its
              permission keys to the catalogue and granting them — no rework of existing roles.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
