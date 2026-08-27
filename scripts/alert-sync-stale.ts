// Alerts by email when a Provider stops syncing. Runs as a STANDALONE process
// from the system crontab, not inside `analytics`: an in-process notifier cannot
// report that its own app is down. See
// docs/handoff/alert-when-a-gateway-sync-fails.md.
//
//   pnpm tsx scripts/alert-sync-stale.ts [--dry-run]
//
// Reads watermarks out of basket_sync_state, which records success only. There
// is no per-Provider error string to quote yet (SyncScheduler discards the
// RunSyncResult), so every message states the last known-good time and how long
// the source has been dark instead.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const DRY_RUN = process.argv.includes('--dry-run');
const STALE_HOURS = Number(process.env.ALERT_STALE_HOURS ?? '48');
const RENOTIFY_HOURS = Number(process.env.ALERT_RENOTIFY_HOURS ?? '24');
const TO = process.env.ALERT_EMAIL_TO ?? '';
const STATE_FILE = process.env.ALERT_STATE_FILE ?? '.alert-sync-state.json';

const MP_PLATFORM = 0;
const STRIPE_PLATFORM = 4;

interface Check {
  id: string;
  provider: string;
  /** null = nothing to check (source is skipped by design, not failed). */
  lastGood: Date | null;
  /** Stated in the mail so a skip never reads as a failure. */
  what: string;
  configured: boolean;
}

interface Fired {
  since: string;
  lastNotifiedAt: string;
}

function hoursSince(d: Date): number {
  return (Date.now() - d.getTime()) / 3_600_000;
}

function fmtHours(h: number): string {
  // Round to whole hours first, then split. Rounding the remainder instead
  // carries wrong and prints "16d 24h".
  const total = Math.round(h);
  const days = Math.floor(total / 24);
  return days > 0 ? `${days}d ${total % 24}h` : `${total}h`;
}

function readState(): Record<string, Fired> {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Record<string, Fired>;
  } catch {
    return {};
  }
}

function newestFileAge(dir: string): Date | null {
  try {
    const times = readdirSync(dir)
      .map((f) => {
        try {
          return statSync(join(dir, f)).mtime;
        } catch {
          return null;
        }
      })
      .filter((t): t is Date => t !== null);
    if (times.length === 0) return null;
    return new Date(Math.max(...times.map((t) => t.getTime())));
  } catch {
    return null;
  }
}

async function main() {
  if (!TO) throw new Error('ALERT_EMAIL_TO not set');

  const { sql } = await import('drizzle-orm');
  const { connection, db } = await import('@shared/db/client');

  try {
    const watermarks = new Map<string, Date>();
    const rows = (await db.execute(
      sql`SELECT source, last_sync FROM basket_sync_state`,
    )) as unknown as { source: string; last_sync: Date }[];
    for (const r of rows) watermarks.set(r.source, new Date(r.last_sync));

    const feeFreshness = (await db.execute(
      sql`SELECT platform, MAX(synced_at) AS synced_at
            FROM basket_payment_fees
           WHERE platform IN (${sql.raw(String(MP_PLATFORM))}, ${sql.raw(String(STRIPE_PLATFORM))})
           GROUP BY platform`,
    )) as unknown as { platform: number; synced_at: Date | null }[];
    const feeSyncedAt = new Map<number, Date | null>(
      feeFreshness.map((r) => [Number(r.platform), r.synced_at ? new Date(r.synced_at) : null]),
    );

    const stripeConfigured = Boolean(
      process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SERVICE_KEY,
    );
    const inbox = process.env.MP_SFTP_INBOX;

    const checks: Check[] = [
      // The run itself, keyed on `content` (step 5) — the first watermark BELOW
      // the payments step that aborts the run. `users` (step 3) is the wrong
      // signal: it sits above the throw, so it advances on every run and reads
      // healthy while everything downstream stays dark. `payments` is the wrong
      // signal too, in the other direction: Pagos are loaded by hand through the
      // UI now, so that watermark is expected to be stale forever.
      {
        id: 'run',
        provider: 'analytics sync run',
        lastGood: watermarks.get('content') ?? null,
        what: 'the content step (5) — the first step below the payments step that aborts the run',
        configured: true,
      },
      {
        id: 'fees:stripe',
        provider: 'Stripe',
        lastGood: watermarks.get('fees:stripe') ?? null,
        what: 'the incremental fee sync watermark (fees:stripe)',
        configured: stripeConfigured,
      },
    ];

    // MercadoPago is export-only by design: `MP_ACCESS_TOKEN not set` is wanted,
    // and `fees:mercadopago` is never expected to advance. Alerting on that
    // watermark would page someone forever. Liveness is the inbox instead —
    // nothing else watches it.
    if (inbox) {
      checks.push({
        id: 'mp:inbox',
        provider: 'MercadoPago',
        lastGood: newestFileAge(inbox),
        what: `the newest file in MP_SFTP_INBOX (${inbox}) — the daily ALLReport`,
        configured: true,
      });
    } else {
      checks.push({
        id: 'mp:fees',
        provider: 'MercadoPago',
        lastGood: feeSyncedAt.get(MP_PLATFORM) ?? null,
        what: 'the newest ingested MP fee row (MP_SFTP_INBOX unset, so no inbox to watch)',
        configured: true,
      });
    }

    const state = readState();
    const next: Record<string, Fired> = {};
    const outbox: { subject: string; text: string }[] = [];

    for (const c of checks) {
      // Skipped is not failed. An unconfigured Provider is silent on purpose.
      if (!c.configured) continue;

      const stale = c.lastGood === null || hoursSince(c.lastGood) > STALE_HOURS;
      const prior = state[c.id];

      if (!stale) {
        if (prior) {
          outbox.push({
            subject: `[data-bp] RECOVERED: ${c.provider} is syncing again`,
            text: [
              `${c.provider} is syncing again.`,
              '',
              `Check: ${c.what}`,
              `Last good: ${c.lastGood!.toISOString()} (${fmtHours(hoursSince(c.lastGood!))} ago)`,
              `Was failing since: ${prior.since}`,
            ].join('\n'),
          });
        }
        continue;
      }

      const since = prior?.since ?? new Date().toISOString();
      const notifiedHoursAgo = prior ? hoursSince(new Date(prior.lastNotifiedAt)) : Infinity;
      const shouldNotify = notifiedHoursAgo >= RENOTIFY_HOURS;

      next[c.id] = { since, lastNotifiedAt: shouldNotify ? new Date().toISOString() : prior!.lastNotifiedAt };
      if (!shouldNotify) continue;

      const dark = c.lastGood ? fmtHours(hoursSince(c.lastGood)) : 'never synced';
      outbox.push({
        subject: `[data-bp] ${c.provider} not syncing for ${dark}`,
        text: [
          `${c.provider} has not synced for ${dark}. Threshold is ${STALE_HOURS}h.`,
          '',
          `Check: ${c.what}`,
          `Last known good: ${c.lastGood ? c.lastGood.toISOString() : 'no watermark at all'}`,
          `Failing since (first detected): ${since}`,
          '',
          'basket_sync_state records success only, so there is no error string to',
          'quote here. For the cause: sudo pm2 logs analytics --err --lines 200',
        ].join('\n'),
      });
    }

    if (Object.keys(next).length === 0) {
      console.log(`[alert] all checks healthy (threshold ${STALE_HOURS}h)`);
    } else if (outbox.length === 0) {
      console.log(
        `[alert] ${Object.keys(next).join(', ')} still failing; ` +
          `next mail after ${RENOTIFY_HOURS}h`,
      );
    }

    for (const mail of outbox) {
      if (DRY_RUN) {
        console.log(`--- would send to ${TO} ---\n${mail.subject}\n\n${mail.text}\n`);
        continue;
      }
      const { sendMail } = await import('@shared/lib/mailer');
      await sendMail({ to: TO, subject: mail.subject, text: mail.text });
      console.log(`[alert] sent: ${mail.subject}`);
    }

    if (!DRY_RUN) writeFileSync(STATE_FILE, JSON.stringify(next, null, 1));
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('[alert] failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
