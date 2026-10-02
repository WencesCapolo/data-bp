import type { ReactNode } from 'react';
import { InfoHint } from './InfoHint';

/** A dashboard card: a title with its "?", an optional line on what it
 *  shows, controls on the right, and the chart or table. */
export function Card({
  title,
  hint,
  desc,
  actions,
  className = '',
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card min-w-0 p-5 ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="card-title flex items-center">
                {title}
                {hint && <InfoHint text={hint} />}
              </h2>
            )}
            {desc && <p className="card-desc">{desc}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
