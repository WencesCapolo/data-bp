import Link from 'next/link';
import type { Dashboard } from '@/lib/dashboards';

export function DashboardCard({ dashboard }: { dashboard: Dashboard }) {
  const isSoon = dashboard.status === 'soon';

  const body = (
    <>
      {isSoon && <span className="tag tag-neutral absolute top-4 right-4 uppercase">soon</span>}
      <div className="grid size-11 place-items-center rounded-[var(--panel-radius)] bg-accent-soft font-display text-2xl text-accent">
        {dashboard.icon}
      </div>
      <h2 className="font-display text-xl font-semibold tracking-wide uppercase">{dashboard.title}</h2>
      <p className="text-sm leading-relaxed text-muted">{dashboard.description}</p>
      <div className="mt-auto pt-2 text-sm font-semibold text-accent">{isSoon ? 'Próximamente' : 'Abrir →'}</div>
    </>
  );

  const className = 'card relative flex flex-col gap-3 p-6';
  if (isSoon) return <div className={`${className} cursor-not-allowed opacity-55`}>{body}</div>;
  return (
    <Link
      href={dashboard.href}
      className={`${className} transition hover:-translate-y-0.5 hover:border-[var(--accent-border)] hover:shadow-[var(--shadow-lift)]`}
    >
      {body}
    </Link>
  );
}
