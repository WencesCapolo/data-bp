// Smoke test for the fee-Export Upload path: preview → confirm → fee mirror.
//
//   pnpm smoke:fee-upload
//
// Same idiom as scripts/smoke-payments-upload.ts — a live server at API_BASE and
// an INTERNAL_API_TOKEN the proxy honours outside production — and the same
// rule: every assertion is on externally observable behaviour, the DTOs in
// FeeUploadDTO.ts and the rows the endpoints write.
//
// The fixture is the real July 2024 Cobros Export in data/, because its quirks
// are the point: the fee is quoted negative, the withholding has no column at
// all, and the dates are day-first. A synthetic file would smooth over all three.
//
// The screen must land exactly what `pnpm ingest:gateway-exports` lands for the
// same file — that is the criterion this script exists to check.

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';
import type {
  FeeUploadPreviewDTO,
  FeeUploadRejection,
  FeeUploadResultDTO,
} from '@basket/core/dtos/FeeUploadDTO';

const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const TOKEN = process.env.INTERNAL_API_TOKEN;
const UPLOAD = '/api/basket/fees/upload';
const INGEST = '/api/basket/fees/ingest';

/** What the CLI landed for this file, per the handoff's State of play. */
const COBROS = {
  path: resolve(process.cwd(), 'data/collection-20260821141711-ff51.xlsx'),
  rows: 10_056,
  gross: 75_011_659,
  fee: 1_350_189.76,
  tax: 4_135_643.02,
  net: 69_525_826.22,
  windowFrom: '2024-07-01',
  windowTo: '2024-07-31',
};

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(46)} ${detail}`);
}

const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

async function post(path: string, body: FormData | string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      ...(TOKEN ? { 'x-internal-token': TOKEN } : {}),
      ...(typeof body === 'string' ? { 'content-type': 'application/json' } : {}),
    },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function upload(path: string, filename: string, source = 'mercadopago_cobros'): Promise<{ status: number; json: unknown }> {
  const form = new FormData();
  form.append('source', source);
  form.append('file', new Blob([new Uint8Array(readFileSync(path))]), filename);
  return post(UPLOAD, form);
}

async function feeRowCount(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM basket_payment_fees WHERE platform = 0
  `);
  return Number((rows as unknown as { n: number }[])[0]?.n ?? 0);
}

async function main(): Promise<void> {
  if (!TOKEN) throw new Error('INTERNAL_API_TOKEN is not set — the endpoints answer 401 without it');
  if (!existsSync(COBROS.path)) throw new Error(`fixture missing: ${COBROS.path}`);

  console.log('=== preview ===\n');

  const previewRes = await upload(COBROS.path, 'collection-julio-2024.xlsx');
  const preview = previewRes.json as FeeUploadPreviewDTO;
  check('the screen accepts an .xlsx', previewRes.status === 200, `HTTP ${previewRes.status}`);
  check(
    'it reads the rows the CLI reads',
    preview?.rows === COBROS.rows,
    `${preview?.rows?.toLocaleString?.('es-AR') ?? '—'} of ${COBROS.rows.toLocaleString('es-AR')}`,
  );
  check(
    'the amounts match the CLI to the cent',
    near(preview?.grossTotal, COBROS.gross) && near(preview?.feeTotal, COBROS.fee) &&
      near(preview?.taxTotal, COBROS.tax) && near(preview?.netTotal, COBROS.net),
    `gross ${preview?.grossTotal} fee ${preview?.feeTotal} tax ${preview?.taxTotal} net ${preview?.netTotal}`,
  );
  check(
    'commission and withholding are reported apart',
    preview?.feePct > 1.5 && preview?.feePct < 2.1 && preview?.taxPct > 4 && preview?.taxPct < 7,
    `comisión ${preview?.feePct}% · retención ${preview?.taxPct}%`,
  );
  check(
    'the Window is read day-first',
    preview?.windowFrom?.slice(0, 10) === COBROS.windowFrom &&
      preview?.windowTo?.slice(0, 10) === COBROS.windowTo,
    `${preview?.windowFrom?.slice(0, 10)} → ${preview?.windowTo?.slice(0, 10)}`,
  );
  check(
    'nothing was written by the preview',
    typeof preview?.uploadId === 'string' && preview.uploadId.length === 36,
    `uploadId ${preview?.uploadId ?? 'none'}`,
  );

  console.log('\n=== what a wrong file gets ===\n');

  // A file whose `net` column moved. It parses, its header is right, and its
  // arithmetic CLOSES — the withholding is a residual, so whatever is missing
  // between gross and net becomes the tax. Only the ratio gives it away: this
  // file claims MercadoPago withheld half the charge.
  const broken = resolve(tmpdir(), 'broken-cobros.csv');
  writeFileSync(
    broken,
    'ID de operación (operation_id),Monto (transaction_amount),Tarifa de Mercado Pago (mercadopago_fee),' +
      'Monto neto recibido (net_received_amount),Fecha de aprobación (date_approved),Estado (status)\n' +
      '111,1000.00,-18.00,500.00,01/07/2024 10:00:00,approved\n' +
      '222,2000.00,-36.00,900.00,02/07/2024 10:00:00,approved\n',
  );
  try {
    const brokenRes = await upload(broken, 'broken.csv');
    const rejection = brokenRes.json as FeeUploadRejection;
    check(
      'a moved amount column is refused before writing',
      brokenRes.status === 400 && rejection?.error === 'implausible_amounts',
      `HTTP ${brokenRes.status} · ${rejection?.error ?? '—'}`,
    );

    // Net above gross: the residual goes negative, which is the case the
    // invariant itself catches.
    const negative = resolve(tmpdir(), 'negative-cobros.csv');
    writeFileSync(
      negative,
      'ID de operación (operation_id),Monto (transaction_amount),Tarifa de Mercado Pago (mercadopago_fee),' +
        'Monto neto recibido (net_received_amount),Fecha de aprobación (date_approved),Estado (status)\n' +
        '111,1000.00,-18.00,1400.00,01/07/2024 10:00:00,approved\n',
    );
    const negRes = await upload(negative, 'negative.csv');
    check(
      'net above gross is refused too',
      negRes.status === 400 && (negRes.json as FeeUploadRejection)?.error === 'invariant_broken',
      `HTTP ${negRes.status} · ${(negRes.json as FeeUploadRejection)?.error ?? '—'}`,
    );
    rmSync(negative, { force: true });

    const notCobros = resolve(tmpdir(), 'not-cobros.csv');
    writeFileSync(notCobros, 'id,user_id,amount\n1,2,3\n');
    const headerRes = await upload(notCobros, 'not-cobros.csv');
    check(
      'a different Export is refused by its header',
      headerRes.status === 400 && (headerRes.json as FeeUploadRejection)?.error === 'bad_header',
      `HTTP ${headerRes.status} · ${(headerRes.json as FeeUploadRejection)?.error ?? '—'}`,
    );
    rmSync(notCobros, { force: true });

    const unknownRes = await upload(COBROS.path, 'x.xlsx', 'stripe_pagos');
    check(
      'an unknown source is refused',
      unknownRes.status === 400 && (unknownRes.json as FeeUploadRejection)?.error === 'unknown_source',
      `HTTP ${unknownRes.status} · ${(unknownRes.json as FeeUploadRejection)?.error ?? '—'}`,
    );
  } finally {
    rmSync(broken, { force: true });
  }

  console.log('\n=== confirm ===\n');

  const before = await feeRowCount();
  const ingestRes = await post(
    INGEST,
    JSON.stringify({ uploadId: preview.uploadId, source: 'mercadopago_cobros' }),
  );
  const result = ingestRes.json as FeeUploadResultDTO;
  check('confirming writes the mirror', ingestRes.status === 200, `HTTP ${ingestRes.status}`);
  check(
    'it upserts every row it previewed',
    result?.upserted === preview.rows,
    `${result?.upserted?.toLocaleString?.('es-AR') ?? '—'} upserted`,
  );
  check(
    'the totals survive the round trip',
    near(result?.grossTotal, COBROS.gross) && near(result?.netTotal, COBROS.net),
    `gross ${result?.grossTotal} net ${result?.netTotal}`,
  );
  check(
    'the view that reads fees is rebuilt',
    typeof result?.viewRefreshMs === 'number',
    result?.viewRefreshMs === null ? 'refresh failed — rows are in, view lags' : `${result?.viewRefreshMs} ms`,
  );

  const after = await feeRowCount();
  check(
    're-ingesting a file already loaded adds nothing',
    after === before,
    `${before.toLocaleString('es-AR')} → ${after.toLocaleString('es-AR')} MercadoPago fee rows`,
  );

  // The handle is single-use: its file is deleted once confirmed, so a second
  // confirm must not half-ingest a file that is no longer there.
  const replay = await post(
    INGEST,
    JSON.stringify({ uploadId: preview.uploadId, source: 'mercadopago_cobros' }),
  );
  check(
    'a confirmed handle cannot be replayed',
    replay.status === 400 && (replay.json as FeeUploadRejection)?.error === 'expired',
    `HTTP ${replay.status} · ${(replay.json as FeeUploadRejection)?.error ?? '—'}`,
  );

  // Provenance, in the same table the Pagos Upload and the CLI write to.
  const rows = await db.execute<{ uploaded_by: string; rows_ingested: number }>(sql`
    SELECT uploaded_by, rows_ingested FROM basket_payment_uploads
    ORDER BY id DESC LIMIT 1
  `);
  const last = (rows as unknown as { uploaded_by: string; rows_ingested: number }[])[0];
  check(
    'the Upload leaves a provenance row',
    Number(last?.rows_ingested) === COBROS.rows,
    `${last?.uploaded_by ?? '—'} · ${Number(last?.rows_ingested ?? 0).toLocaleString('es-AR')} rows`,
  );

  console.log(failures === 0 ? '\n✓ all checks passed' : `\n✗ ${failures} check(s) failed`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('smoke failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end({ timeout: 5 });
  });
