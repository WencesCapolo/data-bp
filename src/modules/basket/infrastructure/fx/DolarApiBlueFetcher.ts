import type { FxRateProps } from '@basket/core/entities/FxRate';
import type { IFxRateSource } from '@basket/core/ports/IFxRate';
import { getJson } from '@basket/infrastructure/gateways/httpJson';

/** Daily history, 2011-01-03 → today, every calendar day. ~5,700 rows, ~250 KB. */
const HISTORY = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/blue';
/** Today's quote, updated intraday. The history lags it by a day. */
const SPOT = 'https://dolarapi.com/v1/dolares/blue';

const BASE = 'USD';
const QUOTE = 'ARS';
export const BLUE_SOURCE = 'blue';

interface HistoryRow {
  casa: string;
  compra: number | null;
  venta: number | null;
  fecha: string;
}

interface SpotRow {
  compra: number | null;
  venta: number | null;
  fechaActualizacion: string;
}

export interface DolarApiBlueFetcherConfig {
  onRetry?: (info: { attempt: number; status: number | null; waitMs: number; reason: string }) => void;
  /** Skip the spot call. The history alone lags by a day; the cron wants both. */
  includeSpot?: boolean;
}

/**
 * The blue ARS rate, as the product owner named it: dolarapi.
 *
 * Two endpoints, and the history is the one that matters. Converting a 2024 Pago
 * at today's rate is the fastest way to publish a wrong revenue figure, and the
 * spot endpoint is all `dolarapi.com` offers — so the sister API's daily history
 * is the source and the spot is only how today gets a rate before the history
 * catches up.
 *
 * The history cannot be windowed: the endpoint takes no parameters and answers
 * with every day it has. `since` therefore filters what was already downloaded
 * rather than what was asked for — a quarter of a megabyte, which is cheaper
 * than the machinery to avoid it.
 *
 * `venta` is the rate, `compra` is carried alongside for audit. They differ by
 * ~1.3% and revenue arriving is a sale of dollars, so venta is the defensible
 * side; the choice lives in the column comment on basket_fx_rates.rate too, so
 * it cannot be lost with this file.
 */
export class DolarApiBlueFetcher implements IFxRateSource {
  readonly source = BLUE_SOURCE;
  readonly baseCurrency = BASE;
  readonly quoteCurrency = QUOTE;

  constructor(private readonly cfg: DolarApiBlueFetcherConfig = {}) {}

  async fetch(since?: string): Promise<FxRateProps[]> {
    const history = await getJson<HistoryRow[]>(HISTORY, { onRetry: this.cfg.onRetry });
    const byDay = new Map<string, FxRateProps>();

    for (const row of history) {
      const day = (row.fecha ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (since && day < since) continue;
      // A row with no venta is not a rate. Falling back to compra here would
      // put the wrong side of a 1.3% spread into a column documented as venta.
      if (row.venta == null || !(row.venta > 0)) continue;
      byDay.set(day, {
        day,
        baseCurrency: BASE,
        quoteCurrency: QUOTE,
        source: this.source,
        rate: row.venta,
        buyRate: row.compra ?? null,
      });
    }

    if (this.cfg.includeSpot !== false) {
      const spot = await this.fetchSpot();
      // Overwrites the history's own row for that day on purpose: the spot is
      // the same day quoted later, so it is the fresher of two rates for one
      // key, not a second rate.
      if (spot) byDay.set(spot.day, spot);
    }

    return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  /** Today's quote, or null when the endpoint answers without a venta. */
  private async fetchSpot(): Promise<FxRateProps | null> {
    const spot = await getJson<SpotRow>(SPOT, { onRetry: this.cfg.onRetry });
    if (spot.venta == null || !(spot.venta > 0)) return null;
    // fechaActualizacion is a UTC instant; the day it belongs to is the day in
    // Buenos Aires, which is where the market it quotes is.
    const day = buenosAiresDay(spot.fechaActualizacion);
    if (!day) return null;
    return {
      day,
      baseCurrency: BASE,
      quoteCurrency: QUOTE,
      source: this.source,
      rate: spot.venta,
      buyRate: spot.compra ?? null,
    };
  }
}

/** YYYY-MM-DD in America/Argentina/Buenos_Aires, or null if unparseable. */
function buenosAiresDay(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}
