export type Role = 'admin' | 'viewer';

export interface Dashboard {
  slug: string;
  title: string;
  description: string;
  href: string;
  icon: string;
  roles: Role[];
  status: 'live' | 'soon';
}

export const DASHBOARDS: Dashboard[] = [
  {
    slug: 'basket-subs',
    title: 'Suscripciones',
    description: 'Suscriptores, churn, evolución, equipos, calidad de datos.',
    href: '/basket',
    icon: '◉',
    roles: ['admin', 'viewer'],
    status: 'live',
  },
  {
    slug: 'partidos',
    title: 'Partidos',
    description: 'Emisiones nacionales e internacionales por canal.',
    href: '/partidos',
    icon: '▶',
    roles: ['admin', 'viewer'],
    status: 'live',
  },
  {
    slug: 'financiero',
    title: 'Financiero',
    description: 'Ingresos brutos y netos, comisiones, planes y suscripciones.',
    href: '/financiero',
    icon: '$',
    roles: ['admin', 'viewer'],
    status: 'live',
  },
];

export function dashboardsForRole(role: Role): Dashboard[] {
  return DASHBOARDS.filter((d) => d.roles.includes(role));
}

export function findDashboard(slug: string): Dashboard | undefined {
  return DASHBOARDS.find((d) => d.slug === slug);
}
