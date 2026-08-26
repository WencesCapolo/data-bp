// The two checks that stand between a fee Export and the mirror, in one place
// because there are now three mouths on the same pipe: the Upload screen, the
// CLI, and the SFTP inbox the cron walks. The screen has a human looking at a
// preview; the other two have nobody, which is exactly why the check cannot
// live in the endpoint.
//
// See docs/handoff/mercadopago-sftp-all-transactions.md — "The invariant cannot
// catch a moved `net` column".

import type { FeeExportSourceSpec, FeeUploadRejection } from './FeeUploadDTO';

/** The invariant migration 0015 promises, in the Export's own currency. */
export const INVARIANT_TOLERANCE = 1;

export interface FeeExportTotals {
  gross: number;
  fee: number;
  tax: number;
  net: number;
  /**
   * Money given back — refunds and chargebacks. Absent in an Export that cannot
   * see reversals at all (the Cobros Export is `approved` only), which is why it
   * defaults to zero rather than being required.
   */
  refunded?: number;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 100;
}

/**
 * Refuses a file whose amount columns are not the ones they claim to be.
 *
 * Two distinct failures, in the order they can be detected:
 *
 *   1. `gross − refunded − fee − tax ≠ net`. The reversal term is what the
 *      Cobros-era version of this check did not need and the all-transactions
 *      report cannot do without: `net` there is net **of refunds and
 *      chargebacks**, while `gross` counts charges only, so a month with one
 *      chargeback in it misses by exactly the chargeback. Zero by construction
 *      whenever the withholding is the residual, so for the Cobros Export what
 *      this actually catches is a *negative* residual (net above gross) and an
 *      absent net column; for a report that states its withholding it is a real
 *      arithmetic check.
 *   2. The arithmetic closes and the figures are still wrong. A file whose `net`
 *      column moved balances perfectly and reports MercadoPago keeping half the
 *      money; only the ratio sees it.
 *
 * Returns the rejection the Upload endpoint would have returned, or null when
 * the file passes. Messages are Spanish because the screen shows them verbatim;
 * the unattended callers log them.
 */
export function checkFeeTotals(
  spec: FeeExportSourceSpec,
  totals: FeeExportTotals,
): FeeUploadRejection | null {
  const residual = round2(
    totals.gross - (totals.refunded ?? 0) - totals.fee - totals.tax - totals.net,
  );
  if (Math.abs(residual) > INVARIANT_TOLERANCE) {
    return {
      error: 'invariant_broken',
      message:
        'No cierra la aritmética del archivo: ' +
        `bruto − reembolsos − comisión − retención − neto = ${residual.toLocaleString('es-AR')}. ` +
        'Alguna columna de importes se movió o cambió de nombre, así que el archivo se rechaza ' +
        'antes de escribir nada.',
    };
  }

  // A file with no charges in it is not automatically wrong: a report window can
  // legitimately hold nothing but reversals — a quiet day, a month whose charges
  // all fell outside it — and refusing those would refuse exactly the movements
  // this whole feed exists to carry. What is wrong is a file with neither.
  const refunded = totals.refunded ?? 0;
  if (totals.gross <= 0 && refunded <= 0) {
    return {
      error: 'implausible_amounts',
      message:
        'El archivo no declara ni cobros ni reembolsos: el bruto es cero o negativo y no hay reversiones. ' +
        'Alguna columna de importes no es la que parece.',
    };
  }
  if (totals.gross <= 0) return null;

  const taxShare = pct(totals.tax, totals.gross);
  if (taxShare > spec.maxTaxPct) {
    return {
      error: 'implausible_amounts',
      message:
        `La retención daría ${taxShare}% del bruto y en ${spec.label} ronda el 5,5%. ` +
        'La retención no tiene columna propia: es lo que falta entre el bruto y el neto, ' +
        'así que un número así significa que la columna de neto no es la de neto. ' +
        'El archivo se rechaza antes de escribir nada.',
    };
  }

  return null;
}
