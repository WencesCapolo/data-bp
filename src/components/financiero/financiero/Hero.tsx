'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { useFilterQS } from '@/lib/client/filterStore';
import { InfoHint } from '@/components/ui/InfoHint';
import { fmt, fmtDayLong } from './format';
import type { EconomiaDTO } from '@basket/core/dtos/EconomiaDTO';

/**
 * El hero rojo del prototipo, con sus cinco cifras: rango, transacciones,
 * suscriptores únicos, países y hasta cuándo llegan los datos. Lee el mismo
 * DTO que la vista (SWR deduplica la llamada) y responde al rango y a los
 * filtros, así que las cifras del hero y las de las tarjetas cuentan lo mismo.
 */
export function FinancieroHero() {
  const url = `/api/financiero/economia?${useFilterQS()}`;
  const { data } = useSWR<EconomiaDTO>(url, fetcher);

  const months = data ? Array.from(new Set(data.monthlyDetail.map((r) => r.month.slice(0, 7)))).sort() : [];
  const rango = months.length ? `${months[0]} → ${months[months.length - 1]}` : '—';

  return (
    <div className="proto-hero">
      <div className="proto-hero-inner">
        <div className="proto-hero-title">
          <div className="proto-hero-logo" aria-label="Basket.tv">
            {/* eslint-disable-next-line @next/next/no-img-element -- el header ya lo sirve así; es un PNG estático */}
            <img src="/Basket.tv%20horizontal%20rojo.png" alt="Basket.tv" />
          </div>
          <div>
            <div className="proto-hero-subtitle">Dashboard de suscripciones · MercadoPago · Stripe · PayPal</div>
          </div>
        </div>
        <div className="proto-hero-meta">
          <div className="m">
            <span className="k">Rango</span>
            <span className="v">{rango}</span>
          </div>
          <div className="m">
            <span className="k">
              Transacciones
              <InfoHint text="Pagos exitosos dentro del rango y los filtros, todos los Proveedores y monedas juntos. Cuenta eventos de pago, no personas." />
            </span>
            <span className="v">{data ? fmt(data.totals.txCount) : '—'}</span>
          </div>
          <div className="m">
            <span className="k">
              Suscriptores únicos
              <InfoHint text="Personas distintas con al menos un Pago exitoso en el rango. Una misma persona con veinte Pagos cuenta una vez." />
            </span>
            <span className="v">{data ? fmt(data.totals.payers) : '—'}</span>
          </div>
          <div className="m">
            <span className="k">
              Países
              <InfoHint text="Países distintos del suscriptor (no del contenido) entre los Pagos del rango; el suscriptor sin país no cuenta." />
            </span>
            <span className="v">{data ? fmt(data.totals.countries) : '—'}</span>
          </div>
          <div className="m">
            <span className="k">
              Datos hasta
              <InfoHint text="El último día con Pagos ingestados. Todo lo que mira «hoy» en esta pantalla mira ese día: después de la última carga no hay altas y sí vencimientos." />
            </span>
            <span className="v">{data ? fmtDayLong(data.lifecycle.asOf) : '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
