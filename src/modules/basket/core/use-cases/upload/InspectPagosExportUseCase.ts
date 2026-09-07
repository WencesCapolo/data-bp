// The preview step of a Pagos Upload, as a module: given the rows of a staged
// Export and two questions answered by the mirror, say what confirming would do.
// Nothing here touches a file, a request or a database — the adapter streams the
// rows in and the lookups are ports — so a five-row fixture exercises every
// rejection and every warning the Analyst can be shown.
//
// Dates go through the same `parsePanelDate` the mapper uses when it writes the
// mirror, so the Window in the preview and in the provenance row is the Window
// that lands in `basket_payments`.

import {
  PAYMENT_UPLOAD_COLUMNS,
  type PaymentUploadRow,
  type UploadPreviewDTO,
  type UploadRejection,
  type UploadWarning,
} from '@basket/core/dtos/PaymentUploadDTO';
import type { IPagosUploadLookups } from '@basket/core/ports/IUploadLookups';
import { parsePanelDate } from '@basket/core/value-objects/PanelDate';
import { platformName } from '@basket/core/value-objects/Platform';
import { classifyNotApproved } from '@basket/core/value-objects/PaymentStatus';

/** Period, in days, of a monthly Pago — the only one Tiers resolve. */
const MONTHLY_RECURRENT = 30;

export interface StagedExportFacts {
  uploadId: string;
  filename: string;
  byteSize: number;
}

export interface InspectPagosExportInput {
  staged: StagedExportFacts;
  /** Lower-cased header cells, or null when the file has no first line. */
  header: string[] | null;
  rows: AsyncIterable<PaymentUploadRow>;
}

export type PagosInspection =
  | { ok: true; preview: UploadPreviewDTO }
  | { ok: false; rejection: UploadRejection };

interface Tally {
  rowTotal: number;
  minMs: number | null;
  maxMs: number | null;
  byProvider: Record<string, number>;
  approved: number;
  failed: number;
  rejected: number;
  pending: number;
  otherNotApproved: number;
  rowsByUserId: Map<number, number>;
  rowsWithoutUserId: number;
  monthlyRowsByCurrency: Map<string, number>;
}

export class InspectPagosExportUseCase {
  constructor(private readonly lookups: IPagosUploadLookups) {}

  async execute(input: InspectPagosExportInput): Promise<PagosInspection> {
    const expected = PAYMENT_UPLOAD_COLUMNS.map((c) => c.toLowerCase());
    const header = input.header;
    if (!header || header.length !== expected.length || header.some((c, i) => c !== expected[i])) {
      return reject(
        'bad_header',
        'Las columnas del archivo no coinciden con el Export de Pagos. ' +
          `Se esperaban, en este orden: ${PAYMENT_UPLOAD_COLUMNS.join(', ')}.`,
      );
    }

    const acc = await tally(input.rows);
    if (acc.rowTotal === 0) {
      return reject('empty', 'El archivo no tiene filas de datos, solo el encabezado.');
    }

    const windowFrom = acc.minMs === null ? null : new Date(acc.minMs).toISOString();
    const windowTo = acc.maxMs === null ? null : new Date(acc.maxMs).toISOString();
    const windowDays =
      acc.minMs === null || acc.maxMs === null
        ? null
        : Math.max(1, Math.round((acc.maxMs - acc.minMs) / 86_400_000));

    const known = await this.lookups.knownSubscriberIds([...acc.rowsByUserId.keys()]);
    let wouldSkip = acc.rowsWithoutUserId;
    if (known) {
      for (const [id, rows] of acc.rowsByUserId) {
        if (!known.has(id)) wouldSkip += rows;
      }
    }

    const warnings: UploadWarning[] = [];

    // The Pagos Export and the Suscripciones Export share the same 15 columns,
    // so the absence of failures is the only signal that the wrong one was picked.
    if (acc.failed === 0) {
      warnings.push({
        code: 'looks_like_subscriptions',
        message:
          'No hay ningún Pago fallido en el archivo. El Export de Pagos siempre incluye ' +
          'intentos fallidos, así que es probable que hayas subido el Export de Suscripciones.',
      });
    }

    if (wouldSkip > 0) {
      warnings.push({
        code: 'unknown_subscribers',
        message:
          `${wouldSkip} Pagos pertenecen a Suscriptores que el espejo todavía no conoce y se ` +
          'omitirían. La sincronización refresca los Suscriptores primero, así que el número final ' +
          'puede ser menor.',
        count: wouldSkip,
      });
    }

    const tierCurrencies = await this.lookups.monthlyTierCurrencies();
    if (tierCurrencies) {
      let unmappedRows = 0;
      const unmappedCurrencies: string[] = [];
      for (const [currency, rows] of acc.monthlyRowsByCurrency) {
        if (!tierCurrencies.has(currency)) {
          unmappedRows += rows;
          unmappedCurrencies.push(currency.toUpperCase());
        }
      }
      if (unmappedRows > 0) {
        warnings.push({
          code: 'unmapped_price_points',
          message:
            `${unmappedRows} Pagos mensuales usan monedas sin Tier configurado ` +
            `(${unmappedCurrencies.join(', ')}); su tipo de suscripción quedará como "Otros".`,
          count: unmappedRows,
        });
      }
    }

    return {
      ok: true,
      preview: {
        uploadId: input.staged.uploadId,
        filename: input.staged.filename,
        byteSize: input.staged.byteSize,
        rowTotal: acc.rowTotal,
        windowFrom,
        windowTo,
        windowDays,
        byProvider: acc.byProvider,
        approved: acc.approved,
        failed: acc.failed,
        rejected: acc.rejected,
        pending: acc.pending,
        otherNotApproved: acc.otherNotApproved,
        wouldSkip,
        warnings,
      },
    };
  }
}

function reject(error: UploadRejection['error'], message: string): PagosInspection {
  return { ok: false, rejection: { error, message } };
}

/** One pass over the rows. Nothing but counters is retained. */
async function tally(rows: AsyncIterable<PaymentUploadRow>): Promise<Tally> {
  const acc: Tally = {
    rowTotal: 0,
    minMs: null,
    maxMs: null,
    byProvider: {},
    approved: 0,
    failed: 0,
    rejected: 0,
    pending: 0,
    otherNotApproved: 0,
    rowsByUserId: new Map(),
    rowsWithoutUserId: 0,
    monthlyRowsByCurrency: new Map(),
  };

  for await (const row of rows) {
    acc.rowTotal += 1;

    const created = parsePanelDate(row.created);
    if (created) {
      const ms = created.getTime();
      if (acc.minMs === null || ms < acc.minMs) acc.minMs = ms;
      if (acc.maxMs === null || ms > acc.maxMs) acc.maxMs = ms;
    }

    const provider = platformName(Number(row.platform));
    acc.byProvider[provider] = (acc.byProvider[provider] ?? 0) + 1;

    const status = row.status?.trim();
    if (status === '1') acc.approved += 1;
    else if (status === '0') {
      acc.failed += 1;
      const kind = classifyNotApproved(row.status_detail);
      if (kind === 'rejected') acc.rejected += 1;
      else if (kind === 'pending') acc.pending += 1;
      else acc.otherNotApproved += 1;
    }

    const userId = Number(row.user_id);
    if (Number.isInteger(userId) && userId > 0) {
      acc.rowsByUserId.set(userId, (acc.rowsByUserId.get(userId) ?? 0) + 1);
    } else {
      acc.rowsWithoutUserId += 1;
    }

    if (Number(row.recurrent) === MONTHLY_RECURRENT) {
      const currency = (row.currency ?? '').trim().toLowerCase();
      if (currency) {
        acc.monthlyRowsByCurrency.set(currency, (acc.monthlyRowsByCurrency.get(currency) ?? 0) + 1);
      }
    }
  }

  return acc;
}
