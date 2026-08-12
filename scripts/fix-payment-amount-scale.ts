// Corrects Pagos whose stored amount is off from the gateway's by exactly a
// factor of 100 — a decimal-point bug in the Control Panel export.
//
//   tsx --env-file=.env scripts/fix-payment-amount-scale.ts          # dry run
//   tsx --env-file=.env scripts/fix-payment-amount-scale.ts --apply  # writes
//
// Ground truth is basket_payment_fees.gross_amount, read straight from the
// Stripe API, in the presentment currency — the same plane basket_payments.amount
// is in, which is what makes the comparison meaningful at all.
//
// The normal analytics sync now runs this automatically as step 9, so this
// script is for ad-hoc ingests and for inspecting the damage before writing.
// It shares the use case with the sync, so both correct identically.
//
// Scope is deliberately narrow: only an exact 100x or 0.01x ratio is touched.
// Any other disagreement between the mirror and the gateway is a different bug
// with a different cause, and this script reports those rather than "fixing"
// them into a shape nobody has verified.

import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';
import { DrizzlePaymentRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentRepository';
import { ReconcilePaymentAmountsUseCase } from '@basket/core/use-cases/sync/ReconcilePaymentAmountsUseCase';

const APPLY = process.argv.includes('--apply');

interface Row extends Record<string, unknown> {
  currency: string;
  direction: string;
  n: number;
  stored_total: string;
  gateway_total: string;
}

async function main() {
  console.log(`=== Payment amount scale fix (${APPLY ? 'APPLY' : 'dry run'}) ===\n`);

  // Same predicate the UPDATE uses, so the preview cannot drift from the write.
  const candidates = sql`
    SELECT p.id,
           p.currency,
           p.amount        AS stored,
           f.gross_amount  AS truth,
           CASE WHEN p.amount = f.gross_amount * 100 THEN 'stored 100x too high'
                ELSE                                      'stored 100x too low'  END AS direction
    FROM basket_payments p
    JOIN basket_payment_fees f
      ON  f.platform            = p.platform
      AND f.platform_payment_id = p.platform_payment_id
    WHERE p.currency = f.currency
      AND p.amount <> f.gross_amount
      AND f.gross_amount > 0
      AND (p.amount = f.gross_amount * 100 OR p.amount * 100 = f.gross_amount)
  `;

  const summary = await db.execute<Row>(sql`
    SELECT currency, direction, COUNT(*)::int AS n,
           SUM(stored)::numeric(18,2)::text AS stored_total,
           SUM(truth)::numeric(18,2)::text  AS gateway_total
    FROM (${candidates}) c
    GROUP BY currency, direction ORDER BY n DESC
  `);

  const rows = summary as unknown as Row[];
  if (rows.length === 0) {
    console.log('nothing to correct — mirror agrees with the gateways');
    return;
  }

  let total = 0;
  for (const r of rows) {
    total += Number(r.n);
    console.log(
      `${r.currency}  ${r.direction.padEnd(21)} ${String(r.n).padStart(5)} rows  ` +
        `stored ${r.stored_total} → gateway ${r.gateway_total}`,
    );
  }
  console.log(`\ntotal: ${total} rows`);

  // Everything else that disagrees. Not touched, but never silently hidden:
  // an unexplained mismatch growing over time is the signal that something new
  // is broken upstream.
  const others = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM basket_payments p
    JOIN basket_payment_fees f
      ON  f.platform            = p.platform
      AND f.platform_payment_id = p.platform_payment_id
    WHERE p.currency = f.currency
      AND p.amount <> f.gross_amount
      AND NOT (p.amount = f.gross_amount * 100 OR p.amount * 100 = f.gross_amount)
  `);
  const otherCount = Number((others as unknown as { n: number }[])[0]?.n ?? 0);
  console.log(`other unexplained mismatches (left untouched): ${otherCount}`);

  if (!APPLY) {
    console.log('\ndry run — re-run with --apply to write these corrections');
    return;
  }

  // Same use case the sync runs, so the manual path and the automatic one can
  // never drift apart.
  const t = Date.now();
  const { corrected } = await new ReconcilePaymentAmountsUseCase(
    new DrizzlePaymentRepository(),
  ).execute();
  console.log(`\ncorrected ${corrected} rows in ${Math.round((Date.now() - t) / 1000)}s`);

  const left = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM (${candidates}) c`);
  console.log(`remaining scale mismatches: ${Number((left as unknown as { n: number }[])[0]?.n ?? 0)}`);

  // amount is an input to tier classification: basket_price_tiers is keyed by
  // (currency, recurrent, amount), so a corrected amount can change a Pago's
  // sub_type. The mat views must be rebuilt or they keep serving the old one.
  console.log('\nrefreshing materialized views…');
  for (const view of [
    'basket_mat_daily_active',
    'basket_mat_monthly_lifecycle',
    'basket_mat_team_monthly',
    'basket_mat_team_daily',
    'basket_mat_revenue_daily',
  ]) {
    const v = Date.now();
    await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`));
    console.log(`  ${view} (${Math.round((Date.now() - v) / 1000)}s)`);
  }
}

main()
  .catch((err) => {
    console.error('fix failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end({ timeout: 5 });
  });
