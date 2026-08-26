import ExcelJS from 'exceljs';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { parse } from 'csv-parse';
import type {
  IPaymentExportSource,
  PaymentExportRow,
} from '@basket/core/ports/IPaymentExportSource';

const MP_PLATFORM = 0;

/**
 * MercadoPago's *Cobros* Export — the only source of MercadoPago commissions
 * that exists while the API credentials are blocked.
 *
 * The header is bilingual: `Tarifa de Mercado Pago (mercadopago_fee)`. Only the
 * parenthesised machine name is matched, because the Spanish half changes with
 * the panel's language and the account's country while the machine name does
 * not.
 *
 * Three facts about this file that the file does not state:
 *
 *   1. **The commission does not explain the net.** `transaction_amount -
 *      mercadopago_fee` overshoots `net_received_amount` by 5.1%, 7.6% or 9.6%
 *      depending on the row. That gap is tax withheld at source, for which the
 *      Export has no column, and it is recovered here as `taxAmount`. See
 *      migrations/sql/0015 for why it is not folded into the fee.
 *   2. **The fee is quoted negative.** It is a deduction in the Export's frame.
 *      Ours stores what was charged, so the sign is flipped once, here.
 *   3. **Only approved payments appear.** The rejected, refunded, cancelled and
 *      charged-back rows the Pagos mirror holds for the same month are simply
 *      absent, so coverage must be measured against approved Pagos or it will
 *      read as a loss that is not one.
 */
export interface MercadoPagoCobrosExportOptions {
  /**
   * What to record as the origin. The CLI can use the path's own basename, but
   * an Upload's file is staged under a random UUID with no extension, so the
   * screen passes the name the person actually chose — that is what a
   * provenance row has to say.
   */
  originName?: string;
  /**
   * Which reader to use. Inferred from the path's extension when omitted, which
   * a staged Upload does not have: it is content, not a filename, so the caller
   * sniffs the bytes and says.
   */
  format?: 'csv' | 'xlsx';
}

export class MercadoPagoCobrosExport implements IPaymentExportSource {
  readonly platform = MP_PLATFORM;
  readonly slug = 'mercadopago';
  readonly origin: string;

  constructor(
    private readonly filePath: string,
    private readonly options: MercadoPagoCobrosExportOptions = {},
  ) {
    this.origin = options.originName ?? basename(filePath);
  }

  async *stream(): AsyncGenerator<PaymentExportRow> {
    const format = this.options.format
      ?? (this.filePath.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx');
    const rows = format === 'csv' ? readCsv(this.filePath) : readXlsx(this.filePath);

    for await (const raw of rows) {
      const mapped = toExportRow(raw);
      if (mapped) yield mapped;
    }
  }
}

type RawRow = Record<string, string>;

/**
 * Loads the workbook, rather than streaming it.
 *
 * The streaming reader is the obvious choice for a file of unknown size and it
 * does not work here: MercadoPago writes a zip that ExcelJS's stream parser
 * rejects with `invalid signature: 0x41d` before the first row. The whole-file
 * reader accepts the same file. A monthly Export is ~2 MB and is released
 * before the next file is opened, so the ceiling is one month at a time rather
 * than the whole backfill.
 *
 * If MercadoPago ever hands back a year in one file, this is the line to
 * revisit — not by re-trying the stream reader, but by asking the panel for
 * narrower Windows, which it offers.
 */
async function* readXlsx(path: string): AsyncGenerator<RawRow> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return;

  // `values` is 1-based and sparse: empty cells are holes, and trailing empty
  // cells are simply absent. Reading by index against the header's width keeps
  // every column aligned instead of shifting left at the first blank.
  const header = rowValues(worksheet.getRow(1)).map(machineName);

  for (let r = 2; r <= worksheet.rowCount; r += 1) {
    const values = rowValues(worksheet.getRow(r), header.length);
    const out: RawRow = {};
    header.forEach((key, i) => {
      if (key) out[key] = values[i] ?? '';
    });
    yield out;
  }
}

function rowValues(row: ExcelJS.Row, width?: number): string[] {
  const raw = row.values as unknown[];
  const length = width ?? Math.max(0, raw.length - 1);
  return Array.from({ length }, (_, i) => cellText(raw[i + 1]));
}

async function* readCsv(path: string): AsyncGenerator<RawRow> {
  const parser = createReadStream(path).pipe(
    parse({ columns: (hdr: string[]) => hdr.map(machineName), bom: true, skip_empty_lines: true }),
  );
  for await (const row of parser) yield row as RawRow;
}

/**
 * `Tarifa de Mercado Pago (mercadopago_fee)` → `mercadopago_fee`.
 *
 * Falls back to the whole header, lower-cased, so a column without the
 * parenthesised name is still addressable rather than silently dropped.
 */
function machineName(header: string): string {
  const match = /\(([a-z0-9_]+)\)\s*$/i.exec(header.trim());
  return (match ? match[1] : header.trim()).toLowerCase();
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // ExcelJS wraps formula and rich-text cells; both carry the rendered value.
    const rich = value as { result?: unknown; text?: string; richText?: { text: string }[] };
    if (rich.richText) return rich.richText.map((r) => r.text).join('');
    if (rich.text != null) return rich.text;
    if (rich.result != null) return String(rich.result);
    return '';
  }
  return String(value);
}

function toExportRow(raw: RawRow): PaymentExportRow | null {
  const id = (raw.operation_id ?? '').trim();
  // A row without the Provider's id can never join a Pago. Dropping it is not a
  // loss: there is nothing it could ever be matched to.
  if (!id) return null;

  const gross = num(raw.transaction_amount);
  // Quoted negative in the Export; stored as what was charged.
  const fee = Math.abs(num(raw.mercadopago_fee));
  const net = num(raw.net_received_amount);

  // The withholding is the residual, and it is only trustworthy when all three
  // numbers are present. Where the residual is negative — a coupon or a
  // financing cost credited back — it is not a withholding, so it stays null
  // rather than being reported as a negative tax.
  const residual = round2(gross - fee - net);
  const tax = gross > 0 && net > 0 && residual > 0.01 ? residual : null;

  return {
    platformPaymentId: id,
    grossAmount: round2(gross),
    // The Export carries no currency column: this is the ARS account, and every
    // row in it is ARS. A row in another currency would need its own Export.
    currency: 'ARS',
    feeAmount: round2(fee),
    taxAmount: tax,
    netAmount: round2(net),
    refundedAmount: round2(Math.abs(num(raw.amount_refunded))),
    status: raw.status?.trim() || null,
    // date_approved is when the money was captured; date_created is when the
    // Subscriber started paying, and the two straddle a month boundary often
    // enough to matter. basket_payments is dated by creation, so the fee mirror
    // uses approval and every view says which clock it picked.
    capturedAt: parseDate(raw.date_approved) ?? parseDate(raw.date_created),
    payerEmail: raw.counterpart_email?.trim().toLowerCase() || null,
    operationType: raw.operation_type?.trim() || null,
  };
}

function num(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/\s/g, '').replace(/,/g, '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * `31/07/2024 23:20:16` → Date.
 *
 * Day-first, which is the one thing here that silently produces a wrong answer
 * rather than an error: `Date.parse` reads the same string as month-first and
 * would move every payment before the 13th into the wrong month. ISO strings
 * are accepted too, because the xlsx reader hands back real dates when a cell
 * happens to be typed as one.
 */
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim());
  if (dmy) {
    const [, d, m, y, hh = '0', mm = '0', ss = '0'] = dmy;
    return new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The header's machine names, for a caller that needs to refuse a file before
 * ingesting it.
 *
 * Reads the same way `stream()` does — whole-workbook for .xlsx, first line for
 * .csv — so what it reports is what the ingest would see. A monthly Export is
 * ~2 MB, so loading it twice (once to check, once to read) costs less than
 * discovering a wrong Export in a chart three days later.
 */
export async function readCobrosHeader(
  filePath: string,
  format: 'csv' | 'xlsx',
): Promise<string[]> {
  if (format === 'csv') {
    for await (const row of readCsv(filePath)) return Object.keys(row);
    return [];
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  return rowValues(worksheet.getRow(1)).map(machineName).filter(Boolean);
}
