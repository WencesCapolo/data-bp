import type { Dashboard } from '@/lib/dashboards';

export function DashboardCard({ dashboard }: { dashboard: Dashboard }) {
  const isSoon = dashboard.status === 'soon';
  const className = isSoon ? 'dash-card disabled' : 'dash-card';

  const body = (
    <>
      {isSoon && <span className="dash-card-soon">soon</span>}
      <div className="dash-card-icon">{dashboard.icon}</div>
      <h2 className="dash-card-title">{dashboard.title}</h2>
      <p className="dash-card-desc">{dashboard.description}</p>
      <div className="dash-card-cta">{isSoon ? 'Próximamente' : 'Abrir →'}</div>
    </>
  );

  if (isSoon) return <div className={className}>{body}</div>;
  return (
    <a href={dashboard.href} className={className}>
      {body}
    </a>
  );
}
