// The preview step of a fee Export Upload, as a module: stream the Provider's
// rows once, apply the same arithmetic and ratio checks the unattended paths
// apply, and say what confirming would write. The reader is a port and so are
// the two "does the mirror already have this id" questions, so a fake source of
// a handful of rows covers every rejection and warning.

import {
  type FeeExportSourceSpec,
  type FeeUploadPreviewDTO,
  type FeeUploadRejection,
  type FeeUploadRejectionCode,
  type FeeUploadWarning,
} from '@basket/core/dtos/FeeUploadDTO';
import { checkFeeTotals, pct, round2 } from '@basket/core/dtos/feeTotalsCheck';
import type { IFeeUploadLookups } from '@basket/core/ports/IUploadLookups';
import type { IPaymentExportSource } from '@basket/core/ports/IPaymentExportSource';
import { platformName } from '@basket/core/value-objects/Platform';
import type { StagedExportFacts } from './InspectPagosExportUseCase';

/**
 * How many distinct ids the preview will hold to answer "does a Pago exist for
 * this?". A monthly Cobros Export is ~10k rows; this is two years of them, and
 * past it the question is answered as unknown rather than by growing a Set until
 * the 1 GB box swaps.
 */
export const ID_SAMPLE_CEILING = 250_000;

/** A file wider than this is not wrong, only unexpected: Cobros arrive monthly. */
const WIDE_WINDOW_DAYS = 45;

export interface InspectFeeExportInput {
  staged: StagedExportFacts;
  spec: FeeExportSourceSpec;
  /** Machine names found in the header, lower-cased. */
  header: string[];
  source: IPaymentExportSource;
}

export type FeeInspection =
  | { ok: true; preview: FeeUploadPreviewDTO }
  | { ok: false; rejection: FeeUploadRejection };

export class InspectFeeExportUseCase {
  constructor(private readonly lookups: IFeeUploadLookups) {}

  async execute(input: InspectFeeExportInput): Promise<FeeInspection> {
    const { spec, staged } = input;

    const missing = spec.requiredColumns.filter((c) => !input.header.includes(c));
    if (missing.length > 0) {
      return reject(
        'bad_header',
        `Al archivo le faltan columnas del Export de ${spec.label}: ${missing.join(', ')}. ` +
          'Sólo se mira el nombre entre paréntesis del encabezado, que no cambia con el idioma ' +
          'del panel — así que esto suele significar que es otro Export.',
      );
    }

    const tally = {
      rows: 0, gross: 0, fee: 0, tax: 0, net: 0, refunded: 0, withTax: 0,
      minMs: Infinity, maxMs: -Infinity, duplicates: 0,
    };
    const byStatus: Record<string, number> = {};
    const ids = new Set<string>();
    let idsTruncated = false;
    let currency = '';

    for await (const row of input.source.stream()) {
      tally.rows += 1;
      tally.gross += row.grossAmount;
      tally.fee += row.feeAmount;
      tally.net += row.netAmount;
      tally.refunded += row.refundedAmount;
      if (row.taxAmount != null) {
        tally.withTax += 1;
        tally.tax += row.taxAmount;
      }
      if (row.capturedAt) {
        const ms = row.capturedAt.getTime();
        if (ms < tally.minMs) tally.minMs = ms;
        if (ms > tally.maxMs) tally.maxMs = ms;
      }
      currency ||= row.currency;
      const status = row.status ?? 'sin estado';
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (ids.size >= ID_SAMPLE_CEILING) idsTruncated = true;
      else if (ids.has(row.platformPaymentId)) tally.duplicates += 1;
      else ids.add(row.platformPaymentId);
    }

    if (tally.rows === 0) {
      return reject('empty', 'El archivo tiene el encabezado correcto pero ninguna fila con id de operación.');
    }

    // The assertion the CLI makes per file, and the ratios the invariant cannot
    // make: the SFTP inbox the cron walks has no human looking at a preview and
    // needs exactly these two checks. See core/dtos/feeTotalsCheck.ts.
    const bad = checkFeeTotals(spec, {
      gross: tally.gross, fee: tally.fee, tax: tally.tax, net: tally.net, refunded: tally.refunded,
    });
    if (bad) return reject(bad.error, bad.message);

    const feeShare = pct(tally.fee, tally.gross);
    const idList = [...ids];
    const [inPayments, inFees] = await Promise.all([
      this.lookups.existingPagoIds(idList, spec.platform),
      this.lookups.existingFeeIds(idList, spec.platform),
    ]);

    const warnings: FeeUploadWarning[] = [];
    const unmatched = inPayments ? idList.length - inPayments.size : 0;
    if (inPayments && unmatched > 0) {
      warnings.push({
        code: 'unmatched_payments',
        count: unmatched,
        message:
          `${unmatched.toLocaleString('es-AR')} operaciones del archivo no tienen Pago en el espejo. ` +
          'La comisión se guarda igual, con el id del Provider como clave, y se une sola si el Pago llega después.',
      });
    }
    if (inFees && inFees.size > 0) {
      warnings.push({
        code: 'already_ingested',
        count: inFees.size,
        message:
          `${inFees.size.toLocaleString('es-AR')} operaciones ya tienen comisión cargada. ` +
          'Se sobrescriben con lo que diga este archivo: es un espejo, no un agregado.',
      });
    }
    if (tally.duplicates > 0) {
      warnings.push({
        code: 'duplicate_ids',
        count: tally.duplicates,
        message: `${tally.duplicates.toLocaleString('es-AR')} ids repetidos dentro del mismo archivo; queda la última fila de cada uno.`,
      });
    }
    if (feeShare < spec.feePctRange[0] || feeShare > spec.feePctRange[1]) {
      warnings.push({
        code: 'unexpected_fee_pct',
        message:
          `La comisión da ${feeShare}% del bruto, fuera del ${spec.feePctRange[0]}–${spec.feePctRange[1]}% ` +
          `que cobra ${platformName(spec.platform)}. Mirá que sea el Export y el mes que esperabas.`,
      });
    }
    if (tally.withTax === 0) {
      warnings.push({
        code: 'no_withholding',
        message:
          'Ninguna fila declara retención. En MercadoPago la retención es la diferencia entre bruto y neto, ' +
          'así que un cero acá suele significar que el archivo no es el de Cobros.',
      });
    }
    const spanDays = Number.isFinite(tally.minMs) && tally.maxMs > 0
      ? Math.round((tally.maxMs - tally.minMs) / 86_400_000)
      : 0;
    if (spanDays > WIDE_WINDOW_DAYS) {
      warnings.push({
        code: 'wide_window',
        count: spanDays,
        message:
          `El archivo cubre ${spanDays} días. Los Cobros llegan de a un mes por archivo; ` +
          'uno más ancho no está mal, pero conviene mirar que sea el Export que esperabas.',
      });
    }
    if (idsTruncated) {
      warnings.push({
        code: 'unmatched_payments',
        message:
          'El archivo trae más operaciones de las que el preview compara contra el espejo, ' +
          'así que los cruces de abajo son parciales. La carga en sí no tiene ese límite.',
      });
    }

    return {
      ok: true,
      preview: {
        uploadId: staged.uploadId,
        source: spec.id,
        sourceLabel: spec.label,
        platformName: platformName(spec.platform),
        filename: staged.filename,
        byteSize: staged.byteSize,
        rows: tally.rows,
        skipped: 0,
        currency: currency || 'ARS',
        grossTotal: round2(tally.gross),
        feeTotal: round2(tally.fee),
        taxTotal: round2(tally.tax),
        netTotal: round2(tally.net),
        feePct: feeShare,
        taxPct: pct(tally.tax, tally.gross),
        rowsWithTax: tally.withTax,
        windowFrom: Number.isFinite(tally.minMs) ? new Date(tally.minMs).toISOString() : null,
        windowTo: tally.maxMs > 0 ? new Date(tally.maxMs).toISOString() : null,
        matchedPagos: inPayments ? inPayments.size : 0,
        alreadyIngested: inFees ? inFees.size : 0,
        byStatus,
        warnings,
      },
    };
  }
}

function reject(error: FeeUploadRejectionCode, message: string): FeeInspection {
  return { ok: false, rejection: { error, message } };
}
