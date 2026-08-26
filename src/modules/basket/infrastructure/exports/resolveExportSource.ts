// Which Export is this file? Answered by its header, never by its name.
//
// The Upload screen asks the person which Export they are handing over. The SFTP
// inbox has nobody to ask: MercadoPago's report centre chooses the filename and
// can be reconfigured to change the file's columns without telling us. So the
// bytes decide the reader and the header decides the Export, and a file that
// matches nothing is refused rather than guessed at.

import { readStagedHead, sniffBinary } from '@shared/lib/uploadStaging';
import {
  FEE_EXPORT_SOURCES,
  type FeeExportSourceSpec,
  type FeeUploadRejectionCode,
} from '@basket/core/dtos/FeeUploadDTO';
import type { IPaymentExportSource } from '@basket/core/ports/IPaymentExportSource';
import { MercadoPagoCobrosExport, readCobrosHeader } from './MercadoPagoCobrosExport';
import {
  MercadoPagoAllTransactionsExport,
  readAllTransactionsHeader,
} from './MercadoPagoAllTransactionsExport';

/**
 * Constructors, by source id. The header check lives in the spec, which is
 * shared with the screen; only this map knows which class reads it. Everything
 * that ingests a fee Export — the Upload screen, the confirm endpoint, the CLI,
 * the SFTP inbox — goes through here, so a new Export is one entry plus one spec.
 */
const READERS: Record<
  string,
  (path: string, format: 'csv' | 'xlsx', originName: string) => IPaymentExportSource
> = {
  mercadopago_cobros: (path, format, originName) =>
    new MercadoPagoCobrosExport(path, { format, originName }),
  mercadopago_all_transactions: (path, format, originName) =>
    new MercadoPagoAllTransactionsExport(path, { format, originName }),
};

/** The reader a caller already knows the source of — the screen asks the person. */
export function createExportSource(
  specId: string,
  path: string,
  format: 'csv' | 'xlsx',
  originName: string,
): IPaymentExportSource | null {
  return READERS[specId]?.(path, format, originName) ?? null;
}

/**
 * The header, read the way the Export in question reads it.
 *
 * Two different readers because the two files disagree about what a header is:
 * the Cobros Export hides machine names in parentheses behind Spanish labels and
 * may be a workbook, while the all-transactions report is CSV whose columns are
 * the machine names already.
 */
export async function readExportHeader(
  path: string,
  format: 'csv' | 'xlsx',
): Promise<string[]> {
  const [cobros, all] = await Promise.all([
    readCobrosHeader(path, format).catch(() => [] as string[]),
    format === 'csv' ? readAllTransactionsHeader(path).catch(() => [] as string[]) : Promise.resolve([]),
  ]);
  // Union, so one call answers for either Export. The names cannot collide:
  // `mercadopago_fee` exists in one and `settlement_net_amount` in the other.
  return [...new Set([...cobros, ...all])];
}

export interface ResolvedExportSource {
  spec: FeeExportSourceSpec;
  source: IPaymentExportSource;
  format: 'csv' | 'xlsx';
  header: string[];
}

export interface UnresolvedExportSource {
  error: FeeUploadRejectionCode;
  message: string;
  header: string[];
}

export type ExportSourceResolution = ResolvedExportSource | UnresolvedExportSource;

export function isResolved(r: ExportSourceResolution): r is ResolvedExportSource {
  return 'source' in r;
}

export async function resolveExportSource(
  path: string,
  originName: string,
): Promise<ExportSourceResolution> {
  const signature = sniffBinary(await readStagedHead(path));
  if (signature === 'xls') {
    return { error: 'bad_format', message: 'es un .xls viejo; el panel entrega .xlsx o CSV', header: [] };
  }
  if (signature === 'binary') {
    return { error: 'bad_format', message: 'no es ni un .xlsx ni un CSV de texto', header: [] };
  }
  const format: 'csv' | 'xlsx' = signature === 'xlsx' ? 'xlsx' : 'csv';

  const header = await readExportHeader(path, format);
  if (header.length === 0) {
    return { error: 'empty', message: 'no tiene encabezado legible', header };
  }

  // First spec whose required columns are all present. The specs are disjoint in
  // practice — the Cobros Export names `mercadopago_fee`, the all-transactions
  // report does not — and if they ever stop being, the order here decides, which
  // is why a new spec goes after the ones that already work.
  for (const spec of FEE_EXPORT_SOURCES) {
    const reader = READERS[spec.id];
    if (!reader) continue;
    if (spec.requiredColumns.every((c) => header.includes(c))) {
      return { spec, source: reader(path, format, originName), format, header };
    }
  }

  return {
    error: 'bad_header',
    message:
      `el encabezado no es de ningún Export conocido (${header.slice(0, 8).join(', ')}…). ` +
      'Se miran los nombres entre paréntesis, que no cambian con el idioma del panel.',
    header,
  };
}
