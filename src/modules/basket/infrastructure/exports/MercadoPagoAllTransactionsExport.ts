import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parse } from 'csv-parse/sync';
import type {
  IPaymentExportSource,
  PaymentExportRow,
} from '@basket/core/ports/IPaymentExportSource';

const MP_PLATFORM = 0;

/**
 * MercadoPago's *Reporte de todas las transacciones* (`ALLReport`), the report
 * the panel pushes to our SFTP inbox on a schedule.
 *
 * Everything below was measured against the first real file MP delivered
 * (`ALLReport-manual-2026-08-25-115005.csv`, 332 movements, 2026-08-16 → 08-24),
 * because until it existed every column name was an assumption. Five facts about
 * it that the Cobros Export does not share:
 *
 *   1. **It is one row per movement, not per Pago.** A settlement, a refund and
 *      a chargeback are separate rows carrying the same `SOURCE_ID`, so the rows
 *      of one operation are folded into one `PaymentExportRow` here. Yielding
 *      them straight through would have each movement overwrite the last in a
 *      mirror keyed `(platform, platform_payment_id)`, and the surviving row
 *      would be whichever movement the file happened to end with.
 *   2. **It carries the reversals.** `TRANSACTION_TYPE` is `SETTLEMENT` for a
 *      charge and `CHARGEBACK` / `REFUND` for a reversal, whose amounts arrive
 *      negative and whose fee and withholding arrive positive — the money coming
 *      back. That is the entire reason this report exists: the Cobros Export is
 *      `approved` only, so MP's refund column read zero everywhere.
 *   3. **The withholding is stated, not derived.** `TAXES_AMOUNT` gives it
 *      outright, and `TRANSACTION_AMOUNT + FEE_AMOUNT + TAXES_AMOUNT =
 *      SETTLEMENT_NET_AMOUNT` held on all 332 rows of the sample. So this
 *      adapter does NOT compute tax as the residual the way
 *      `MercadoPagoCobrosExport` must — see migration 0015, which documents the
 *      residual as the only way to get it. It is no longer the only way.
 *   4. **The dates carry their offset** (`2026-08-24T22:47:29.000-04:00`), so
 *      there is no day-first trap here and no clock to guess: `new Date` reads
 *      them as the instants they are and the mirror stores true UTC. The panel's
 *      *zona horaria* setting only decides what offset is printed.
 *   5. **It is not valid CSV.** See `repairJsonFields`.
 */
export interface MercadoPagoAllTransactionsExportOptions {
  /** What to record as the origin: the name a person chose, or the file MP left. */
  originName?: string;
  /** Accepted for symmetry with the Cobros adapter. This report is always CSV —
   *  the panel's `.zip` option is off and nothing here unzips. */
  format?: 'csv' | 'xlsx';
}

export class MercadoPagoAllTransactionsExport implements IPaymentExportSource {
  readonly platform = MP_PLATFORM;
  readonly slug = 'mercadopago';
  readonly origin: string;

  constructor(
    private readonly filePath: string,
    options: MercadoPagoAllTransactionsExportOptions = {},
  ) {
    this.origin = options.originName ?? basename(filePath);
  }

  /**
   * Reads the whole file, folds it, then yields.
   *
   * Not streamed, and it cannot be: an operation's movements are not guaranteed
   * to be adjacent — the sample's chargeback is dated eight days before the
   * settlements around it — so the fold has to see the file before it can emit
   * the first row. A month of movements is a few MB and a few tens of thousands
   * of operations; if MP ever hands back a year in one file, ask the panel for a
   * narrower window, which it offers.
   */
  async *stream(): AsyncGenerator<PaymentExportRow> {
    const raw = await readFile(this.filePath, 'utf8');
    const rows = parse(repairJsonFields(raw), {
      bom: true,
      skip_empty_lines: true,
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    }) as Record<string, string>[];

    const folded = new Map<string, Folded>();
    for (const row of rows) {
      const id = (row.source_id ?? '').trim();
      // A movement with no id can never join a Pago, and there is nothing it
      // could be folded into either.
      if (!id) continue;
      if (isAccountAdjustment(row)) continue;
      fold(folded, id, row);
    }

    for (const [id, op] of folded) yield toExportRow(id, op);
  }
}

interface Folded {
  gross: number;
  refunded: number;
  fee: number;
  tax: number;
  net: number;
  currency: string;
  capturedAt: Date | null;
  reversed: 'charged_back' | 'refunded' | null;
  subscriptionId: string | null;
}

/**
 * A charge MercadoPago made against the account, not a Pago somebody made to us.
 *
 * It arrives with **no `TRANSACTION_TYPE` at all** and a `TRANSACTION_AMOUNT` of
 * zero, carrying only a negative `FEE_AMOUNT` — the monthly commission invoice
 * and its kin. Measured across the six yearly files: 20 such movements, every
 * one of them untyped, every untyped one of them amount-zero, and every one the
 * only movement its `SOURCE_ID` has. Folding them produced 20 operations with a
 * gross of zero and a fee of 13,7 M ARS, 11,9 M of it in 2024 alone — a third of
 * that year's real commission, invented.
 *
 * They cannot be told apart by sign (`FEE_AMOUNT` is negative on an ordinary
 * settlement too) and they must not be told apart by amount alone, so the test
 * is the absent type. The identity still closes without them: they contribute
 * `gross 0 − fee f = net −f`, which is self-cancelling.
 */
function isAccountAdjustment(row: Record<string, string>): boolean {
  return (row.transaction_type ?? '').trim() === '' && num(row.transaction_amount) === 0;
}

/**
 * What a movement does to an operation, decided by its type and not by the sign
 * of its amount.
 *
 * The sign alone is a trap, and a measured one: `CHACKBACK_CANCEL` — the dispute
 * we won — arrives with a *positive* amount, and reading it as a charge doubled
 * the gross of 13 operations in the first full file while leaving them marked
 * charged back. Types are matched by substring because MP's vocabulary is longer
 * than any list we can be sure of: `SETTLEMENT`, `CHARGEBACK`,
 * `CHARGEBACK_CANCEL`, `REFUND` are the four seen so far, and a `REFUND_CANCEL`
 * would classify correctly without this file changing.
 */
function classify(type: string, amount: number): 'charge' | 'reversal' | 'cancel' {
  const t = type.toUpperCase();
  const reversalWord = t.includes('CHARGEBACK') || t.includes('REFUND') || t.includes('DISPUTE');
  if (reversalWord && t.includes('CANCEL')) return 'cancel';
  if (reversalWord || amount < 0) return 'reversal';
  return 'charge';
}

function fold(acc: Map<string, Folded>, id: string, row: Record<string, string>): void {
  const op = acc.get(id) ?? {
    gross: 0, refunded: 0, fee: 0, tax: 0, net: 0,
    currency: '', capturedAt: null, reversed: null, subscriptionId: null,
  };

  const amount = num(row.transaction_amount);
  const type = (row.transaction_type ?? '').trim();
  // The file's frame is the account's: a charge deducts the commission, a
  // reversal credits it back, a cancelled reversal deducts it again. Ours stores
  // what was charged, so every one of them is flipped and they cancel out
  // instead of accumulating.
  op.fee -= num(row.fee_amount);
  op.tax -= num(row.taxes_amount);
  op.net += num(row.settlement_net_amount);

  switch (classify(type, amount)) {
    case 'reversal':
      op.refunded += Math.abs(amount);
      // Precedence, not last-writer: a chargeback is the harder fact about an
      // operation and MP can report both against one payment.
      if (type.toUpperCase().includes('CHARGEBACK')) op.reversed = 'charged_back';
      else if (op.reversed !== 'charged_back') op.reversed = 'refunded';
      break;
    case 'cancel':
      // The reversal was undone. Not a second charge: the money never left.
      op.refunded -= Math.abs(amount);
      break;
    default:
      op.gross += amount;
  }

  op.currency ||= (row.transaction_currency ?? '').trim().toUpperCase();
  const at = parseDate(row.transaction_date);
  // The earliest movement is the charge; a reversal's own date is not when the
  // money was captured, and the mirror is bucketed by capture.
  if (at && (!op.capturedAt || at < op.capturedAt)) op.capturedAt = at;
  op.subscriptionId ||= preapprovalId(row.metadata);

  acc.set(id, op);
}

function toExportRow(id: string, op: Folded): PaymentExportRow {
  const tax = round2(op.tax);
  // A window can hold a cancel whose chargeback fell outside it, which would
  // leave the reversal total negative. It is not a negative refund: a
  // `CHARGEBACK_CANCEL` re-states the charge — same amount, same commission, same
  // withholding as the settlement it restores — so whatever the cancels exceed
  // the reversals by IS the charge, as far as this file can tell. Moving it there
  // is also what keeps `gross − refunds − fee − tax = net` true, which a clamp
  // alone broke by 47.586 ARS across the first full file.
  const overCancelled = op.refunded < 0 ? round2(-op.refunded) : 0;
  const refunded = Math.max(0, round2(op.refunded));
  const gross = round2(op.gross + overCancelled);
  return {
    platformPaymentId: id,
    grossAmount: gross,
    currency: op.currency || 'ARS',
    feeAmount: round2(op.fee),
    // Stated by the report rather than derived from the gap between gross and
    // net. Zero is a real answer here — a Pago whose withholding was zero — so
    // only an absent figure becomes null.
    taxAmount: tax === 0 ? null : tax,
    netAmount: round2(op.net),
    refundedAmount: refunded,
    // This report has no status column: the end state of an operation is what
    // its movements did to it, which is exactly what the fold knows. A reversal
    // that was cancelled leaves nothing behind — the operation is `approved`
    // again, not charged back.
    status: refunded > 0 ? (op.reversed ?? 'refunded') : 'approved',
    capturedAt: op.capturedAt,
    // Not in this report at all. The Cobros Export names the payer; this one
    // names a `PAYER_NAME` that arrived empty on every row of the sample.
    payerEmail: null,
    // Derived rather than stated, the way the Cobros Export states it: a
    // `preapproval_id` in METADATA means MP charged this on a subscription.
    operationType: op.subscriptionId ? 'recurring_payment' : 'regular_payment',
    subscriptionId: op.subscriptionId,
  };
}

/**
 * MercadoPago writes JSON into `METADATA` and `TAXES_DISAGGREGATED` as a quoted
 * field whose inner quotes are **not** doubled:
 *
 *     …,"[{"financial_entity":"caba","amount":"-2012.50"}]",…
 *
 * That is not CSV, and it is not a cosmetic problem. A strict parser stops at
 * line 2 (`Invalid Closing Quote`); `relax_quotes` splits the blob at every
 * comma inside it, which shifts every column after it — and the columns after it
 * include `TAXES_AMOUNT` and `SETTLEMENT_NET_AMOUNT`. Measured on the sample:
 * 205 of 332 rows silently read a withholding of zero and an invariant that did
 * not close.
 *
 * So the blobs are repaired before the parser sees them. Each one starts with
 * `"[{` and ends with `}]"` at a field boundary — a comma, a newline, or the end
 * of the file — and the quotes between those markers are doubled, which is what
 * the file should have said in the first place. After this, every row of the
 * sample parses to 53 fields and the invariant closes on all 332.
 *
 * The alternative was to switch the two JSON columns off in the panel. It was
 * rejected: `METADATA` carries the `preapproval_id` that links a Pago to a
 * MercadoPago subscription — 205 of 332 rows had one — and a report shape that
 * depends on nobody ever re-ticking a checkbox is not a shape worth having.
 */
export function repairJsonFields(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('"[{', i);
    if (start === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, start + 1);
    let end = start + 1;
    for (;;) {
      end = text.indexOf('}]"', end);
      if (end === -1) break;
      const after = text[end + 3];
      // The blob ends where the *field* ends. A `}]"` in the middle of the JSON
      // is followed by something else and is not the terminator.
      if (after === undefined || after === ',' || after === '\n' || after === '\r') break;
      end += 3;
    }
    if (end === -1) {
      // Unterminated blob: hand the rest over untouched and let the parser
      // complain about the file rather than silently mangling it here.
      out += text.slice(start + 1);
      break;
    }
    out += text.slice(start + 1, end + 2).replace(/"/g, '""');
    out += '"';
    i = end + 3;
  }
  return out;
}

/** `[{"available_tries":3,"preapproval_id":"58ab…"}]` → `58ab…`. */
function preapprovalId(metadata: string | undefined): string | null {
  if (!metadata) return null;
  const m = /"preapproval_id"\s*:\s*"([a-z0-9]+)"/i.exec(metadata);
  return m ? m[1] : null;
}

function num(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/\s/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * `2026-08-24T22:47:29.000-04:00` → Date.
 *
 * ISO with an explicit offset, which is the one date format in this codebase
 * that needs no help: the offset is in the string, so the instant is unambiguous
 * whatever the panel's *zona horaria* is set to. Kept as a named function anyway
 * so the day the panel starts printing `24/08/2026` this is the one place to
 * teach it, the way `MercadoPagoCobrosExport.parseDate` had to be taught.
 */
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The header's column names, lower-cased, for a caller that needs to refuse a
 * file before ingesting it. Reads only the first line — the repair is irrelevant
 * to a header, which carries no JSON.
 */
export async function readAllTransactionsHeader(filePath: string): Promise<string[]> {
  const raw = await readFile(filePath, 'utf8');
  const firstLine = raw.slice(0, raw.search(/\r?\n/) === -1 ? undefined : raw.search(/\r?\n/));
  const parsed = parse(firstLine, { bom: true, relax_quotes: true, relax_column_count: true }) as string[][];
  return (parsed[0] ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
}
