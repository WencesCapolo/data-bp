// Proves the contract cashflow reads (migrations/sql/0024): the role it connects
// as can read the three published views and nothing else.
//
//   CASHFLOW_READER_URL=postgres://cashflow_reader:…@127.0.0.1:5432/basket_analytics \
//     tsx scripts/smoke-cashflow-contract.ts
//
// Read-only: every statement is a SELECT, and the INSERT it attempts must fail.
import postgres from 'postgres';

const VIEWS = ['basket_v_cashflow_credits', 'basket_v_cashflow_fx', 'basket_v_cashflow_freshness'];
const FORBIDDEN = ['basket_payments', 'basket_gateway_movements', 'basket_gateway_payouts', 'basket_fx_rates'];

async function main() {
  const url = process.env.CASHFLOW_READER_URL;
  if (!url) throw new Error('CASHFLOW_READER_URL not set');
  const sql = postgres(url, { max: 1 });
  let failures = 0;
  const check = (ok: boolean, label: string) => {
    console.log(`${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failures += 1;
  };

  try {
    for (const view of VIEWS) {
      const ok = await sql.unsafe(`SELECT * FROM ${view} LIMIT 1`).then(() => true, () => false);
      check(ok, `reads ${view}`);
    }
    for (const table of FORBIDDEN) {
      const denied = await sql.unsafe(`SELECT 1 FROM ${table} LIMIT 1`).then(() => false, () => true);
      check(denied, `cannot read ${table}`);
    }
    const insertDenied = await sql
      .unsafe(`INSERT INTO basket_gateway_movements (platform, movement_id, type, currency, net_amount) VALUES (0, 'smoke', 'X', 'ARS', 0)`)
      .then(() => false, () => true);
    check(insertDenied, 'cannot write');
  } finally {
    await sql.end();
  }
  if (failures) throw new Error(`${failures} check(s) failed`);
}

main().catch((err) => {
  console.error('smoke failed:', (err as Error).message);
  process.exitCode = 1;
});
