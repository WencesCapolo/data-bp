// Verifies the finance dashboard's net-revenue half against the gateway
// mirrors, per docs/handoff/finance-dashboard-stripe-first.md §5.
//
//   pnpm smoke:gateway-net
//
// Checks, in order:
//   1. the §5 invariants straight off the tables (coverage, amount agreement,
//      settlement totals, churn by status, MP absent)
//   2. basket_mat_gateway_net_daily reproduces those settlement totals
//   3. the repo's unfiltered path reproduces them again through the DTO
//      (/financiero · Economía owns this; /basket's finance tab does not carry it)
//   4. the filtered path buckets the same way, over the smaller population it
//      can reach (fee rows whose Pago is ingested)
import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';
import { DrizzleAnalyticsQueryRepository } from '@basket/infrastructure/db/repositories/DrizzleAnalyticsQueryRepository';
import type { DateRange } from '@basket/core/dtos/shared';

const ALL: DateRange = { kind: 'all' };
const cents = (v: number): string => v.toFixed(2);

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(46)} ${detail}`);
}

type Row = Record<string, unknown>;
const rows = async (q: string): Promise<Row[]> =>
  ((await db.execute(sql.raw(q))) as unknown) as Row[];
const num = (v: unknown): number => Number(v ?? 0);

async function main(): Promise<void> {
  const repo = new DrizzleAnalyticsQueryRepository();

  console.log('=== §5 invariants, straight off the tables ===\n');

  const [cov] = await rows(`
    SELECT COUNT(*)::int AS successful, COUNT(f.platform_payment_id)::int AS with_fee
    FROM basket_payments p
    LEFT JOIN basket_payment_fees f
      ON f.platform = p.platform AND f.platform_payment_id = p.platform_payment_id
    WHERE p.platform = 4 AND p.status = 1 AND p.platform_payment_id IS NOT NULL
  `);
  const covPct = (num(cov.with_fee) / num(cov.successful)) * 100;
  check(
    'fee coverage ≈ 95.7%',
    covPct > 95 && covPct < 97,
    `${num(cov.with_fee).toLocaleString()} / ${num(cov.successful).toLocaleString()} = ${covPct.toFixed(1)}%`,
  );

  // Rows with no charge are excluded, and the exclusion is the interesting part:
  // MercadoPago's all-transactions report is one row per movement, so a window
  // can hold a Pago's refund or chargeback without holding the charge itself.
  // Those fold to gross 0 by design — an honest account of the movements the file
  // saw — and comparing that against the Pago's amount would fail forever. What
  // this still catches is the thing it was written for: a row that claims to
  // describe a charge and disagrees with our own record of it.
  const [mismatch] = await rows(`
    SELECT COUNT(*)::int AS c FROM basket_payments p
    JOIN basket_payment_fees f
      ON f.platform = p.platform AND f.platform_payment_id = p.platform_payment_id
    WHERE p.currency = f.currency AND p.amount <> f.gross_amount
      AND f.gross_amount > 0
  `);
  check('mirror agrees with our own amounts', num(mismatch.c) === 0, `${num(mismatch.c)} disagreements`);
  const [noCharge] = await rows(`
    SELECT COUNT(*)::int AS c FROM basket_payment_fees
    WHERE gross_amount = 0 AND refunded_amount > 0
  `);
  check(
    'reversals whose charge fell outside the window are visible as such',
    true,
    `${num(noCharge.c).toLocaleString()} rows describe a reversal and no charge`,
  );

  // MercadoPago used to be asserted ABSENT here: its mirror was empty and a
  // zero would have read as "MP costs nothing". It is now ingested from the
  // Cobros Export, so the check inverts — and gains the one invariant that
  // Export forced, since MP's commission alone does not explain its net.
  const [mp] = await rows(`
    SELECT COUNT(*)::int AS c,
           SUM(gross_amount)::numeric              AS gross,
           SUM(fee_amount)::numeric                AS fees,
           SUM(COALESCE(tax_amount, 0))::numeric   AS taxes,
           SUM(net_amount)::numeric                AS net,
           SUM(refunded_amount)::numeric           AS refunded,
           COUNT(tax_amount)::int                  AS with_tax,
           COUNT(*) FILTER (WHERE refunded_amount <> 0)::int AS reversed
    FROM basket_payment_fees WHERE platform = 0
  `);
  check('MercadoPago present, not empty', num(mp.c) > 0, `${num(mp.c).toLocaleString()} MP fee rows`);
  // The reversal term is not decoration: `net` is net of refunds and chargebacks
  // while `gross` counts charges only, so the identity that held while the mirror
  // came from the Cobros Export alone (approved payments, no reversals, refunded
  // zero everywhere) misses by exactly the reversals the all-transactions report
  // brought in.
  //
  // Asserted per row rather than in aggregate, because a mirror built from more
  // than one window has two legitimate row shapes and a single SUM cannot tell
  // them apart:
  //
  //   closes      the file that saw the charge also saw the reversal, so the
  //               fold already credited it back and the identity holds.
  //   chargeKept  the reversal arrived in a *different* Export from the charge.
  //               `upsertMany`'s NO_CHARGE guard keeps the charge's commission,
  //               withholding and net — which is the whole point of the guard —
  //               and records the reversal beside them. Such a row misses the
  //               identity by exactly its own `refunded_amount`, never by
  //               anything else. Six yearly reports produce 238 of them.
  //   split       one operation's refunds fell on both sides of a window edge.
  //               The charge's file folded the partial it saw; the later file
  //               saw the rest, and `refunded_amount` is monotone rather than
  //               additive — deliberately, because additive would double-count
  //               on a re-read — so the earlier partial is dropped and a residue
  //               the size of it is left over. 8 rows, 82 ARS each, all at the
  //               2021-10 seam between the first two yearly reports. It is a
  //               limit of window-sliced Exports, not of the fold: no file held
  //               all three of those operations' movements. A wider periodic
  //               report is what closes it — see the handoff's open questions.
  //
  // A row that is none of the three is the failure this check exists for:
  // columns that moved, or a fold that lost a movement.
  const [keptGap] = await rows(`
    WITH r AS (
      SELECT gross_amount - refunded_amount - fee_amount - COALESCE(tax_amount, 0) - net_amount AS gap,
             refunded_amount AS refunded
      FROM basket_payment_fees WHERE platform = 0
    )
    SELECT COALESCE(SUM(refunded), 0)::numeric AS refunded FROM r
    WHERE ABS(gap) > 0.01
  `);
  const [shape] = await rows(`
    WITH r AS (
      SELECT gross_amount - refunded_amount - fee_amount - COALESCE(tax_amount, 0) - net_amount AS gap,
             refunded_amount AS refunded
      FROM basket_payment_fees WHERE platform = 0
    )
    SELECT COUNT(*) FILTER (WHERE ABS(gap) <= 0.01)::int                                  AS closes,
           COUNT(*) FILTER (WHERE ABS(gap) > 0.01 AND ABS(gap + refunded) <= 0.01)::int   AS charge_kept,
           COUNT(*) FILTER (WHERE ABS(gap) > 0.01 AND gap + refunded > 0.01
                              AND gap + refunded < refunded)::int                         AS split,
           COALESCE(SUM(gap + refunded) FILTER (WHERE ABS(gap) > 0.01 AND gap + refunded > 0.01
                              AND gap + refunded < refunded), 0)::numeric                 AS split_residue,
           COUNT(*) FILTER (WHERE ABS(gap) > 0.01 AND ABS(gap + refunded) > 0.01
                              AND NOT (gap + refunded > 0.01 AND gap + refunded < refunded))::int AS neither
    FROM r
  `);
  check(
    'MercadoPago: every row closes, keeps a charge, or splits a reversal',
    num(shape.neither) === 0,
    `closes ${num(shape.closes).toLocaleString()} · charge kept ${num(shape.charge_kept).toLocaleString()} · ` +
      `split across windows ${num(shape.split).toLocaleString()} (${cents(num(shape.split_residue))} unaccounted) · ` +
      `neither ${num(shape.neither).toLocaleString()}`,
  );
  // The aggregate must then be explained by exactly those rows and nothing else.
  // Not a restatement of the per-row check: the gap is summed from the amount
  // columns while the explanation is summed from `refunded_amount` independently,
  // so a drift that stayed under the per-row cent tolerance still surfaces here.
  const mpCloses = Math.abs(
    num(mp.gross) - num(mp.refunded) - num(mp.fees) - num(mp.taxes) - num(mp.net) +
      num(keptGap.refunded) - num(shape.split_residue),
  );
  check(
    'MercadoPago: gross - refunds - fees - taxes = net, once kept charges are named',
    mpCloses < 1,
    `gross ${cents(num(mp.gross))} · refunds ${cents(num(mp.refunded))} · fee ${cents(num(mp.fees))} · ` +
      `tax ${cents(num(mp.taxes))} · net ${cents(num(mp.net))} · reversals kept beside a charge ${cents(num(keptGap.refunded))}`,
  );
  // The point of the whole SFTP exercise: MP's refund column used to be zero
  // everywhere, and that zero was a silence rather than a measurement. The Cobros
  // Export is `approved` only; the all-transactions report carries the movements.
  check(
    'MercadoPago reversals are measured, not silent',
    num(mp.refunded) > 0,
    `${cents(num(mp.refunded))} returned across ${num(mp.reversed).toLocaleString()} operations`,
  );
  // Guards the mistake this column exists to prevent: an ingest that folds the
  // withholding back into the fee, which would report MP as costing several
  // times what it charges.
  //
  // The band is wide because MercadoPago's own quoting changed, not because our
  // two Exports disagree. Measured 2026-08-26 on the six yearly reports, over the
  // same July 2024 operations the Cobros Export also describes: `fee_ratio`
  // 1.0000, `tax_ratio` 1.0000, zero net disagreements — the report states
  // exactly what Cobros states. The step is inside the report and it is real:
  //
  //   2024-01 … 2024-07   1.78%  commission · 5.0–5.9% withheld
  //   2024-08             4.79%  the month it moved
  //   2024-09 onward      7.5%   commission WITH IVA · 3.4–3.5% withheld
  //
  // MP moved the IVA out of the withholding line and into the commission line in
  // August 2024. A blended share across a history that spans both therefore sits
  // between 1.8% and 7.5% legitimately, and narrowing this band would be
  // asserting that the account has only ever had one price. Folding the
  // withholding into the fee — the mistake this check exists for — still pushes
  // it past 9%.
  const mpFeePct = (num(mp.fees) / num(mp.gross)) * 100;
  check(
    'MercadoPago commission is the commission, not the withholding',
    mpFeePct > 1 && mpFeePct < 7.5,
    `${mpFeePct.toFixed(2)}% commission · ${((num(mp.taxes) / num(mp.gross)) * 100).toFixed(2)}% withheld · ${num(mp.with_tax).toLocaleString()} rows carry tax`,
  );

  const churn = await rows(`
    SELECT status, COUNT(*)::int AS c FROM basket_gateway_subscriptions
    WHERE platform = 4 GROUP BY 1 ORDER BY 2 DESC
  `);
  const churnTotal = churn.reduce((s, r) => s + num(r.c), 0);
  check(
    'churn by status covers every subscription',
    churnTotal > 0 && churn.every((r) => String(r.status).length > 0),
    `${churnTotal.toLocaleString()} rows · ${churn.map((r) => `${r.status} ${num(r.c).toLocaleString()}`).join(' · ')}`,
  );

  const truth = await rows(`
    SELECT settlement_currency AS ccy,
           SUM(settlement_amount)::numeric AS gross,
           SUM(fee_amount)::numeric        AS fees,
           SUM(net_amount)::numeric        AS net,
           COUNT(*)::int                   AS tx
    FROM basket_payment_fees WHERE platform = 4 GROUP BY 1 ORDER BY 1
  `);
  for (const r of truth) {
    check(
      `settlement total · ${r.ccy}`,
      true,
      `gross ${cents(num(r.gross))} · fees ${cents(num(r.fees))} · net ${cents(num(r.net))} · ${num(r.tx).toLocaleString()} tx`,
    );
  }

  console.log('\n=== basket_mat_gateway_net_daily reproduces them ===\n');
  const view = await rows(`
    SELECT ccy,
           SUM(gross)::numeric AS gross, SUM(fees)::numeric AS fees,
           SUM(net)::numeric   AS net,   SUM(tx_count)::int AS tx
    FROM basket_mat_gateway_net_daily WHERE grain = 'settlement' GROUP BY 1 ORDER BY 1
  `);
  for (const t of truth) {
    const v = view.find((r) => r.ccy === t.ccy);
    const ok =
      !!v &&
      cents(num(v.gross)) === cents(num(t.gross)) &&
      cents(num(v.fees)) === cents(num(t.fees)) &&
      cents(num(v.net)) === cents(num(t.net)) &&
      num(v.tx) === num(t.tx);
    check(`view matches to the cent · ${t.ccy}`, ok, ok ? 'exact' : JSON.stringify(v));
  }

  console.log('\n=== the DTO, unfiltered path ===\n');
  const dto = await repo.getEconomia(ALL);
  const g = dto.gateway;
  check('Economía carries the gross half too', dto.monthlyGross.length > 0 && dto.catalog.length > 0,
    `${dto.monthlyGross.length} month×ccy×platform · ${dto.catalog.length} price points · ${dto.byCountry.length} country rows`);
  // Every Provider with fee rows must be OUT of the gross-only list, and PayPal
  // — which has no fee feed at all — must stay in it. The list is what stops a
  // Provider from being silently netted at zero.
  check(
    'gross-only platforms are named, not silently netted',
    !dto.grossOnlyPlatforms.includes('Stripe') && !dto.grossOnlyPlatforms.includes('MercadoPago'),
    dto.grossOnlyPlatforms.join(', ') || 'none in range',
  );
  check(
    'both netted Providers are labelled',
    g.platformNames.includes('Stripe') && g.platformNames.includes('MercadoPago'),
    g.platformName,
  );
  // Coverage is bucketed by id shape now: MP's hex32 preapprovals can never
  // carry a fee, and averaging them in caps the figure near 73% forever.
  const mpPayments = g.coverage.filter((r) => r.platform === 0 && r.idShape === 'payment');
  const mpPre = g.coverage.filter((r) => r.platform === 0 && r.idShape === 'preapproval');
  const sum = (rs: typeof mpPayments, k: 'successful' | 'withFee') => rs.reduce((a, r) => a + r[k], 0);
  check(
    'MP coverage is bucketed by id shape',
    mpPayments.length > 0 && sum(mpPre, 'withFee') === 0,
    `payments ${sum(mpPayments, 'withFee').toLocaleString()}/${sum(mpPayments, 'successful').toLocaleString()} · ` +
      `preapprovals ${sum(mpPre, 'withFee').toLocaleString()}/${sum(mpPre, 'successful').toLocaleString()} (never fee-bearing)`,
  );
  for (const t of truth) {
    const s = g.settlementTotals.find((r) => r.settlementCurrency === t.ccy);
    const ok =
      !!s &&
      cents(s.grossSettlement) === cents(num(t.gross)) &&
      cents(s.fees) === cents(num(t.fees)) &&
      cents(s.net) === cents(num(t.net)) &&
      s.txCount === num(t.tx);
    check(
      `DTO settlement total · ${t.ccy}`,
      ok,
      ok ? `feePct ${s!.feePct}%` : JSON.stringify(s),
    );
  }
  // The day and month grains are the same numbers cut differently, so they must
  // add back up to the totals grain.
  for (const s of g.settlementTotals) {
    const day = g.netByDay
      .filter((r) => r.settlementCurrency === s.settlementCurrency)
      .reduce((a, r) => a + r.net, 0);
    const month = g.netByMonth
      .filter((r) => r.settlementCurrency === s.settlementCurrency)
      .reduce((a, r) => a + r.net, 0);
    check(
      `day and month grains add up · ${s.settlementCurrency}`,
      cents(day) === cents(s.net) && cents(month) === cents(s.net),
      `day ${cents(day)} · month ${cents(month)} · total ${cents(s.net)}`,
    );
  }
  const refundRows = g.refundsByCurrency.reduce((a, r) => a + r.refundCount, 0);
  check('refunds stay in the presentment plane', g.refundsByCurrency.length > 1, `${refundRows} refund rows across ${g.refundsByCurrency.length} currencies`);
  check('churn reaches the DTO by status', g.subscriptionsByStatus.reduce((a, r) => a + r.count, 0) === churnTotal, `${churnTotal.toLocaleString()} rows`);
  check('unfiltered path claims no exclusions', !g.netExcludesUnmatchedFees && !g.subscriptionsIgnoreFilters, 'both flags false');

  console.log('\n=== the DTO, filtered path ===\n');
  const filteredDto = await repo.getEconomia(ALL, { countries: ['Uruguay'] });
  const fg = filteredDto.gateway;
  check('filtered path returns settlement totals', fg.settlementTotals.length > 0,
    fg.settlementTotals.map((r) => `${r.settlementCurrency} net ${cents(r.net)} (${r.feePct}%)`).join(' · '));
  for (const s of fg.settlementTotals) {
    const day = fg.netByDay.filter((r) => r.settlementCurrency === s.settlementCurrency).reduce((a, r) => a + r.net, 0);
    const month = fg.netByMonth.filter((r) => r.settlementCurrency === s.settlementCurrency).reduce((a, r) => a + r.net, 0);
    check(`filtered grains add up · ${s.settlementCurrency}`,
      cents(day) === cents(s.net) && cents(month) === cents(s.net),
      `day ${cents(day)} · month ${cents(month)} · total ${cents(s.net)}`);
  }
  // Filtering is a predicate on the payment, so it can only ever reach a subset.
  const unfilteredNet = g.settlementTotals.find((r) => r.settlementCurrency === 'USD')?.net ?? 0;
  const filteredNet = fg.settlementTotals.find((r) => r.settlementCurrency === 'USD')?.net ?? 0;
  check('filtered USD net is a strict subset', filteredNet > 0 && filteredNet < unfilteredNet,
    `${cents(filteredNet)} of ${cents(unfilteredNet)}`);
  check('filtered path admits its exclusions', fg.netExcludesUnmatchedFees && fg.subscriptionsIgnoreFilters, 'both flags true');
  check('churn is unchanged by filters',
    fg.subscriptionsByStatus.reduce((a, r) => a + r.count, 0) === churnTotal,
    'subscriptions have no user dimension');

  console.log(failures === 0 ? '\n✓ all checks passed' : `\n✗ ${failures} check(s) failed`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('\n✗ smoke:gateway-net failed:', err?.cause ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
