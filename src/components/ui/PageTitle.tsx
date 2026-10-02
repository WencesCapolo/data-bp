import type { ReactNode } from 'react';

/** A dashboard's title, as on the other basket-app.com apps. */
export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{children}</h1>
      {sub && <p className="mt-2 text-sm text-muted">{sub}</p>}
    </div>
  );
}
