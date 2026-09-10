import Link from 'next/link';
import { MODULES } from '@/core/modules/registry';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { requirePrincipal } from '@/core/auth/session';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** The launcher. Feature cards on cream, hairline outlines, no shadows. */
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

      <div className="grid gap-base sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => {
          const live = module.status === 'LIVE';
          return (
            <Link
              key={module.key}
              href={module.route}
              className="card flex flex-col p-lg transition-colors hover:border-hairline-strong hover:bg-canvas-soft"
            >
              <div className="mb-base flex items-start justify-between gap-sm">
                <h2 className="text-display-sm text-ink">{module.name}</h2>
                <span className={live ? 'badge badge-success shrink-0' : 'badge badge-outline shrink-0'}>
                  {live ? 'live' : 'soon'}
                </span>
              </div>
              <p className="flex-1 text-body-sm text-body">{module.description}</p>
              {module.plannedFor ? (
                <p className="mt-base border-t border-hairline-soft pt-sm text-caption-uppercase uppercase text-muted-soft">
                  {module.plannedFor}
                </p>
              ) : null}
            </Link>
          );
        })}
      </div>
    </>
  );
}
