import Link from 'next/link';
import { MODULES } from '@/core/modules/registry';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { requirePrincipal } from '@/core/auth/session';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** The launcher. One tile per module; unbuilt modules say so plainly. */
export default async function ModulesPage() {
  const principal = await requirePrincipal();

  const modules = MODULES.filter(
    (module) => module.status !== 'LIVE' || !module.requires || hasPermissionAnywhere(principal, module.requires),
  ).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <>
      <PageHeader
        title="Engineering OS"
        subtitle="Every function of the plant, under one roof. Project Management is live; the rest follow on the roadmap."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => {
          const live = module.status === 'LIVE';
          return (
            <Link
              key={module.key}
              href={module.route}
              className={`card group relative flex flex-col p-5 transition hover:shadow-md ${
                live ? '' : 'opacity-90'
              }`}
            >
              <div className="mb-3 flex items-start justify-between">
                <span className="text-3xl" aria-hidden>
                  {module.icon}
                </span>
                {live ? (
                  <span className="badge bg-emerald-100 text-emerald-700">live</span>
                ) : (
                  <span className="badge bg-amber-100 text-amber-800">coming soon</span>
                )}
              </div>
              <h2 className="text-base font-semibold text-slate-900 group-hover:text-brand-700">{module.name}</h2>
              <p className="mt-1 flex-1 text-sm text-slate-500">{module.description}</p>
              {module.plannedFor ? (
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">{module.plannedFor}</p>
              ) : null}
            </Link>
          );
        })}
      </div>
    </>
  );
}
