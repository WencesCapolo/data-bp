// Verifies the FX plane: the rate table, its provenance, and the USD figures
// the DTO publishes from it. See docs/adr/0007-fx-rates-name-their-source.md.
//
//   pnpm smoke:fx
//
// Checks, in order:
//   1. the table itself — the blue history is whole, every calendar day is
//      present over the span the Pagos cover, and both sources are named
//   2. THE RECONCILIATION: converting Stripe's presentment gross at Stripe's own
//      per-transaction exchange_rate reproduces its settlement to the cent, for
//      one month and for the whole mirror. This is what makes the derived
//      'stripe' rows honest — they are a readable summary of a conversion the
//      rows already agree on, not a second opinion.
//   3. the DTO — USD figures carry their rate, ARS converts day by day rather
//      than at one month rate, and EUR crosses through ARS off one table.
import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';
import { DrizzleAnalyticsQueryRepository } from '@basket/infrastructure/db/repositories/DrizzleAnalyticsQueryRepository';
import { DrizzleFxRateRepository } from '@basket/infrastructure/db/repositories/DrizzleFxRateRepository';
import { majorUnitRate } from '@basket/infrastructure/gateways/money';
import type { DateRange } from '@basket/core/dtos/shared';

const ALL: DateRange = { kind: 'all' };
/** The month MercadoPago's Cobros Export covers — the only ARS month loaded. */
const MP_MONTH = { from: '2024-07-01', to: '2024-07-31' };

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(48)} ${detail}`);
}

type Row = Record<string, unknown>;
const rows = async (q: string): Promise<Row[]> =>
  ((await db.execute(sql.raw(q))) as unknown) as Row[];
const num = (v: unknown): number => Number(v ?? 0);
const money = (v: number): string => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main(): Promise<void> {
  const repo = new DrizzleAnalyticsQueryRepository();
  const fx = new DrizzleFxRateRepository();

  console.log('=== the rate table ===\n');

  const coverage = await fx.coverage();
  const blue = coverage.find((c) => c.source === 'blue');
  check(
    'the blue history is loaded',
    !!blue && blue.days > 5000,
    blue ? `${blue.days.toLocaleString()} days, ${blue.firstDay} → ${blue.lastDay}` : 'no blue rows at all',
  );
  check(
    'the blue rate is USD→ARS, not the reverse',
    !!blue && blue.baseCurrency === 'USD' && blue.quoteCurrency === 'ARS',
    blue ? `${blue.baseCurrency}→${blue.quoteCurrency}` : '—',
  );

  // Every calendar day, weekends included at the previous close. A gap is a
  // broken feed, not a closed market, which is why this is an equality check on
  // zero rather than a tolerance.
  const today = new Date().toISOString().slice(0, 10);
  const gaps = await fx.gaps('blue', 'USD', 'ARS', '2024-05-01', today);
  check(
    'no missing day since Pagos begin',
    gaps.length === 0,
    gaps.length === 0 ? '2024-05-01 → today, every day present' : `${gaps.length} gaps: ${gaps.slice(0, 5).join(', ')}`,
  );

  const [spread] = await rows(`
    SELECT AVG((rate - buy_rate) / NULLIF(buy_rate, 0) * 100)::float8 AS pct,
           COUNT(buy_rate)::int AS with_buy
    FROM basket_fx_rates WHERE source = 'blue' AND day >= '2024-01-01'
  `);
  check(
    'rate is the venta side, compra carried apart',
    num(spread.pct) > 0 && num(spread.pct) < 5,
    `venta is ${num(spread.pct).toFixed(2)}% above compra, ${num(spread.with_buy).toLocaleString()} days carry both`,
  );

  const derived = coverage.filter((c) => c.source === 'stripe');
  check(
    'the derived Stripe rows name their pairs',
    derived.length > 0,
    derived.map((c) => `${c.baseCurrency}→${c.quoteCurrency}`).join(' · ') || 'none',
  );
  // USD→USD would be a rate of 1 dressed up as a conversion; the derivation
  // excludes rows whose presentment and settlement currency agree.
  const identity = derived.filter((c) => c.baseCurrency === c.quoteCurrency);
  check('no identity rate is stored as a conversion', identity.length === 0, `${identity.length} such pairs`);

  console.log('\n=== the reconciliation: Stripe converts to the cent ===\n');

  // The invariant the whole FX plane rests on. Stripe reports a rate per balance
  // transaction; if applying it to the presentment gross does not reproduce the
  // settlement Stripe actually moved, then nothing derived from those rates can
  // be trusted either. Tolerance is one cent per row's own rounding, not a
  // percentage: Stripe rounds each transaction to the settlement currency's
  // minor unit, so the sum drifts by rows/100 at most.
  // Stripe's exchange_rate is minor units per minor unit, so the presentment and
  // settlement divisors have to come back in — see majorUnitRate. Without it CLP
  // reconciles 100× high (it is zero-decimal) and every other currency passes,
  // which is exactly how the error stayed invisible in a single total.
  for (const label of [MP_MONTH.from.slice(0, 7), 'all time']) {
    const where = label === 'all time'
      ? ''
      : `AND captured_at >= '${MP_MONTH.from}'::date AND captured_at < '${MP_MONTH.to}'::date + 1`;
    const pairs = await rows(`
      SELECT currency, settlement_currency,
             COUNT(*)::int                            AS n,
             SUM(settlement_amount)::float8           AS settled,
             SUM(gross_amount * exchange_rate)::float8 AS converted_minor
      FROM basket_payment_fees
      WHERE platform = 4 AND exchange_rate IS NOT NULL
        AND currency <> settlement_currency ${where}
      GROUP BY 1, 2
    `);
    let n = 0;
    let settled = 0;
    let converted = 0;
    for (const p of pairs) {
      n += num(p.n);
      settled += num(p.settled);
      converted += majorUnitRate(num(p.converted_minor), String(p.currency), String(p.settlement_currency));
    }
    const drift = Math.abs(settled - converted);
    // One cent per row: Stripe rounds each transaction to the settlement
    // currency's minor unit, so the sum drifts by rows/100 at most.
    const allowed = n / 100;
    check(
      `gross × Stripe's own rate = settlement · ${label}`,
      n > 0 && drift <= allowed,
      `${n.toLocaleString()} rows, settled ${money(settled)} vs converted ` +
        `${money(converted)}, drift ${drift.toFixed(4)} (allowed ${allowed.toFixed(2)})`,
    );
  }

  // The derived daily rate is a weighted summary of those same rows, so it must
  // reproduce the same settlement when applied to each day's gross.
  const [viaDerived] = await rows(`
    WITH per_day AS (
      SELECT f.captured_at::date AS day, f.currency, f.settlement_currency,
             SUM(f.gross_amount) AS gross, SUM(f.settlement_amount) AS settled
      FROM basket_payment_fees f
      WHERE f.platform = 4 AND f.exchange_rate IS NOT NULL
        AND f.currency <> f.settlement_currency
      GROUP BY 1, 2, 3
    )
    SELECT COUNT(*)::int                          AS days,
           SUM(p.settled)::float8                 AS settled,
           SUM(p.gross * r.rate)::float8          AS via_derived
    FROM per_day p
    JOIN basket_fx_rates r
      ON r.day = p.day AND r.source = 'stripe'
     AND r.base_currency = p.currency AND r.quote_currency = p.settlement_currency
  `);
  const derivedDrift = Math.abs(num(viaDerived.settled) - num(viaDerived.via_derived));
  check(
    "the derived daily rate reproduces that settlement",
    num(viaDerived.days) > 0 && derivedDrift < 1,
    `${num(viaDerived.days).toLocaleString()} day-pairs, drift ${derivedDrift.toFixed(6)}`,
  );

  console.log('\n=== the DTO ===\n');

  const dto = await repo.getGatewayNet(ALL);

  check(
    'every USD figure names the rate that produced it',
    dto.usdTotals.length > 0 && dto.usdTotals.every((t) => t.rateLabel.length > 0),
    dto.usdTotals.map((t) => `${t.settlementCurrency}:${t.rateSource ?? 'sin cotización'}`).join(' · '),
  );

  const usd = dto.usdTotals.find((t) => t.settlementCurrency === 'USD');
  check(
    'a USD settlement is not converted',
    !!usd && usd.rateSource === 'none' && usd.effectiveRate === null,
    usd ? `net ${money(usd.netUsd ?? 0)} USD, rate ${usd.effectiveRate ?? 'ninguna'}` : 'no USD row',
  );

  const ars = dto.usdTotals.find((t) => t.settlementCurrency === 'ARS');
  check(
    'ARS converts at the blue rate',
    !!ars && ars.rateSource === 'blue' && (ars.netUsd ?? 0) > 0,
    ars ? `net ${money(ars.netUsd ?? 0)} USD at ${ars.effectiveRate} ARS/USD over ${ars.daysConverted} days` : 'no ARS row',
  );

  // The whole point of a rate table with a day column. July 2024's blue rate
  // moved through the month, so converting the month's total at any single day's
  // rate lands somewhere else than converting each day at its own.
  const [monthRate] = await rows(`
    SELECT MIN(rate)::float8 AS lo, MAX(rate)::float8 AS hi, AVG(rate)::float8 AS avg
    FROM basket_fx_rates
    WHERE source = 'blue' AND day BETWEEN '${MP_MONTH.from}'::date AND '${MP_MONTH.to}'::date
  `);
  const [arsNet] = await rows(`
    SELECT SUM(net)::float8 AS net FROM basket_mat_gateway_net_daily
    WHERE grain = 'settlement' AND ccy = 'ARS'
  `);
  const naive = num(arsNet.net) / num(monthRate.avg);
  const perDay = ars?.netUsd ?? 0;
  // Not a tolerance check: the two figures simply must not be the same number.
  // How far apart they land is a fact about the month (July 2024's blue moved
  // 9.5%, and the revenue was not spread evenly across it), and asserting a
  // minimum gap would fail on a quiet month for no reason.
  check(
    'the day rate is not the month rate',
    Math.abs(naive - perDay) > 0.005 && num(monthRate.lo) !== num(monthRate.hi),
    `blue ranged ${num(monthRate.lo)}–${num(monthRate.hi)}; per-day ${money(perDay)} vs ` +
      `month-average ${money(naive)} (${(((perDay - naive) / naive) * 100).toFixed(2)}%)`,
  );

  // EUR used to be this file's example of a currency nobody quotes. It is now
  // crossed through ARS off the oficial table (2026-08-26), so what is asserted
  // here is the cross itself: it converts, it names the cross rather than posing
  // as a published EUR/USD quote, and it lands in the band the pair has actually
  // traded in over the range — a leg picked up from the wrong table (blue instead
  // of oficial) would put it near 0,6 and still look like a number.
  const eur = dto.usdTotals.find((t) => t.settlementCurrency === 'EUR');
  const eurRate = eur?.effectiveRate ?? 0;
  check(
    'EUR crosses through ARS, and names the cross',
    !!eur && eur.netUsd !== null && eur.rateSource === 'oficial_cross' &&
      eur.daysMissingRate === 0 && eurRate > 0.8 && eurRate < 1.05,
    eur
      ? `net ${money(eur.netUsd ?? 0)} USD at ${eurRate} EUR/USD over ${eur.daysConverted} days`
      : 'no EUR row',
  );
  // The legs must come from ONE table on ONE day. Asserted against the rows
  // rather than the DTO, because the DTO cannot see which table a leg came from.
  const [legs] = await rows(`
    SELECT COUNT(*)::int AS days,
           MIN(rate)::float8 AS lo, MAX(rate)::float8 AS hi
    FROM basket_fx_rates
    WHERE source = 'oficial_cross' AND base_currency = 'USD' AND quote_currency = 'EUR'
  `);
  check(
    'the EUR cross stays inside a plausible band, every day',
    num(legs.days) > 0 && num(legs.lo) > 0.75 && num(legs.hi) < 1.1,
    `${num(legs.days).toLocaleString()} days, ${num(legs.lo).toFixed(4)}–${num(legs.hi).toFixed(4)} EUR/USD`,
  );
  // The gap fill is bounded, so it must never be the majority of the series.
  const [carried] = await rows(`
    SELECT COUNT(*)::int AS c FROM (
      SELECT rate, LAG(rate) OVER (ORDER BY day) AS prev
      FROM basket_fx_rates
      WHERE source = 'oficial_cross' AND base_currency = 'USD' AND quote_currency = 'EUR'
    ) t WHERE rate = prev
  `);
  check(
    'carried-forward days are the exception, not the series',
    num(carried.c) < num(legs.days) * 0.35,
    `${num(carried.c).toLocaleString()} of ${num(legs.days).toLocaleString()} days repeat the previous quote`,
  );

  const monthly = dto.netUsdByMonth;
  check(
    'the monthly series carries the same provenance',
    monthly.length > 0 && monthly.every((m) => m.rateSource !== undefined),
    `${monthly.length} points, ${new Set(monthly.map((m) => m.settlementCurrency)).size} currencies`,
  );

  // Months add to the range total, per currency — the same grain check the
  // gateway-net smoke makes for the native figures.
  for (const t of dto.usdTotals.filter((x) => x.netUsd !== null)) {
    const sum = monthly
      .filter((m) => m.platform === t.platform && m.settlementCurrency === t.settlementCurrency)
      .reduce((a, m) => a + (m.netUsd ?? 0), 0);
    check(
      `USD months add up · ${t.settlementCurrency}`,
      Math.abs(sum - (t.netUsd ?? 0)) < 0.05,
      `months ${money(sum)} · total ${money(t.netUsd ?? 0)}`,
    );
  }

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
