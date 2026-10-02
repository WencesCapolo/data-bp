'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BotonDeSalir, ChipDeUsuario, Marco, type EnlaceDeNavegacion } from 'basket-tv-ui';
import type { Role } from '@/lib/dashboards';
import { SyncControls } from './SyncControls';

const NOMBRE_DEL_ROL: Record<Role, string> = { admin: 'Admin', viewer: 'Lectura' };

interface DashboardLink {
  slug: string;
  title: string;
  href: string;
}

/** The basket-tv-ui shell with Analytics' sections: Inicio, then each
 *  dashboard the role may open. The sync controls show on the dashboards,
 *  whose data they refresh, and not on Inicio. */
export function MarcoDeAnalytics({
  nombre,
  rol,
  dashboards,
  lanzadorUrl,
  logoutHref,
  campana,
  children,
}: {
  nombre: string;
  rol: Role;
  dashboards: DashboardLink[];
  lanzadorUrl: string | null;
  logoutHref: string;
  /** The Solicitudes bell; null for whoever may not decide them. */
  campana: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const secciones: EnlaceDeNavegacion[] = [
    { clave: 'inicio', titulo: 'Inicio', icono: <IconoInicio />, href: '/', activa: pathname === '/' },
    ...dashboards.map((d) => ({
      clave: d.slug,
      titulo: d.title,
      icono: ICONOS[d.slug] ?? <IconoInicio />,
      href: d.href,
      activa: pathname.startsWith(d.href),
    })),
  ];

  return (
    <Marco
      nombreDeApp="Analytics"
      secciones={secciones}
      lanzadorUrl={lanzadorUrl}
      enlace={Link}
      ancho="amplio"
      cabecera={
        <>
          {pathname !== '/' && <SyncControls />}
          {campana}
          <ChipDeUsuario nombre={nombre} rol={NOMBRE_DEL_ROL[rol]} />
          <BotonDeSalir href={logoutHref} />
        </>
      }
    >
      {children}
    </Marco>
  );
}

// lucide's paths, inline: one icon per section isn't worth a dependency.
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function IconoInicio() {
  return (
    <Svg>
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

const ICONOS: Record<string, ReactNode> = {
  // users
  'basket-subs': (
    <Svg>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Svg>
  ),
  // tv
  partidos: (
    <Svg>
      <rect width="20" height="15" x="2" y="7" rx="2" ry="2" />
      <polyline points="17 2 12 7 7 2" />
    </Svg>
  ),
  // circle-dollar-sign
  financiero: (
    <Svg>
      <circle cx="12" cy="12" r="10" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
      <path d="M12 18V6" />
    </Svg>
  ),
};
