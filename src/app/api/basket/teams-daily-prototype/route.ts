// PROTOTYPE — throwaway BFF for the "subs variation per day per team + followers
// per team" design question. Delete with src/components/prototype/teams-daily.
// Not audited for perf or auth beyond what the sibling basket routes do.
import type { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@shared/db/client';
import { ok, serverError } from '@/lib/api/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ACCESS = new Set(['real', 'voucher', 'antel']);
const SUBTYPES = new Set(['Free', 'Mensual_Basico', 'Mensual_Total', 'Anual_Total', 'Otros']);
// 'all' is capped: the per-user-day expansion costs ~1.3 s per 30 days.
const ALL_DAYS_CAP = 400;
function rangeDays(range: string): number {
  if (range === '90d') return 90;
  if (range === 'all') return ALL_DAYS_CAP;
  if (range === 'ytd') {
    const now = new Date();
    const jan1 = Date.UTC(now.getUTCFullYear(), 0, 1);
    return Math.min(ALL_DAYS_CAP, Math.ceil((now.getTime() - jan1) / 86_400_000) + 1);
  }
  return 30;
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const str = (v: unknown): string => (v == null ? '' : String(v));
const day = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const days = rangeDays(p.get('range') ?? '30d');
  const accessType = p.get('accessType');
  const subType = p.get('subType');
  const countries = p.getAll('countries').filter((c) => /^[\p{L} .'-]{2,40}$/u.test(c));

  let fw = '';
  if (accessType && ACCESS.has(accessType)) fw += ` AND access_type = '${accessType}'`;
  if (subType && SUBTYPES.has(subType)) fw += ` AND sub_type = '${subType}'`;
  if (countries.length) {
    fw += ` AND user_country IN (${countries.map((c) => `'${c.replace(/'/g, "''")}'`).join(',')})`;
  }

  try {
    const [movementRows, followerRows, activeRows, boundRows] = await Promise.all([
      // Merge each Subscriber's payment spans into islands of uninterrupted
      // access (7-day grace, same as every other basket query). An island start
      // is an alta, the day after an island end is a baja, and the active count
      // on any day is the running sum of those +1/-1 events. Islands are built
      // over full history — no window truncation — so an alta is genuinely a new
      // or reactivated Subscriber, never a window edge artefact.
      db.execute(
        sql.raw(`
        WITH params AS (
          SELECT (CURRENT_DATE - 1) AS d_to, (CURRENT_DATE - ${days}) AS d_from
        ),
        spans AS (
          SELECT v.user_id, COALESCE(v.team_id, 0) AS team_id,
                 v.created_at::date AS s,
                 (v.expires_at + INTERVAL '7 days')::date AS e
          FROM basket_v_active_payments v
          WHERE 1 = 1 ${fw}
        ),
        ord AS (
          SELECT user_id, team_id, s, e,
                 MAX(e) OVER (PARTITION BY user_id ORDER BY s
                              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max
          FROM spans
        ),
        grp AS (
          SELECT user_id, team_id, s, e,
                 SUM(CASE WHEN prev_max IS NULL OR s > prev_max + 1 THEN 1 ELSE 0 END)
                   OVER (PARTITION BY user_id ORDER BY s) AS island
          FROM ord
        ),
        islands AS (
          SELECT user_id, team_id, MIN(s) AS s, MAX(e) AS e
          FROM grp GROUP BY user_id, team_id, island
        ),
        ev AS (
          SELECT team_id, s     AS d,  1 AS alta, 0 AS baja FROM islands
          UNION ALL
          SELECT team_id, e + 1 AS d,  0 AS alta, 1 AS baja FROM islands
        ),
        agg AS (
          SELECT team_id, d, SUM(alta)::int AS altas, SUM(baja)::int AS bajas,
                 SUM(alta - baja)::int AS delta
          FROM ev GROUP BY team_id, d
        ),
        days AS (
          SELECT generate_series(p.d_from, p.d_to, INTERVAL '1 day')::date AS d FROM params p
        ),
        universe AS (
          SELECT team_id, d FROM agg
          UNION
          SELECT t.team_id, days.d FROM (SELECT DISTINCT team_id FROM agg) t CROSS JOIN days
        ),
        filled AS (
          SELECT u.team_id, u.d,
                 COALESCE(a.altas, 0) AS altas,
                 COALESCE(a.bajas, 0) AS bajas,
                 SUM(COALESCE(a.delta, 0)) OVER (PARTITION BY u.team_id ORDER BY u.d)::int AS active
          FROM universe u
          LEFT JOIN agg a ON a.team_id = u.team_id AND a.d = u.d
        )
        SELECT f.team_id, f.d AS day, f.altas, f.bajas, f.active
        FROM filled f, params p
        WHERE f.d BETWEEN p.d_from AND p.d_to
      `),
      ),
      db.execute(
        sql.raw(`
        SELECT COALESCE(u.promo_team_id, 0)   AS team_id,
               COALESCE(t.team_name, 'Sin equipo') AS team_name,
               COALESCE(t.league, 'N/A')      AS league,
               COALESCE(t.country, 'N/A')     AS country,
               COUNT(*)::int                  AS followers,
               COUNT(*) FILTER (WHERE u.created_at >= CURRENT_DATE - ${days})::int AS new_followers
        FROM basket_users u
        LEFT JOIN basket_teams t ON t.id = u.promo_team_id
        GROUP BY 1, 2, 3, 4
      `),
      ),
      db.execute(
        sql.raw(`
        SELECT COALESCE(team_id, 0) AS team_id, COUNT(DISTINCT user_id)::int AS active_now
        FROM basket_v_active_payments
        WHERE created_at::date <= CURRENT_DATE - 1
          AND (expires_at + INTERVAL '7 days')::date >= CURRENT_DATE - 1
          ${fw}
        GROUP BY 1
      `),
      ),
      db.execute(sql.raw(`SELECT (CURRENT_DATE - ${days}) AS d_from, (CURRENT_DATE - 1) AS d_to`)),
    ]);

    const bounds = ((boundRows as unknown) as Row[])[0] ?? {};
    const from = day(bounds.d_from);
    const to = day(bounds.d_to);
    const dayList: string[] = [];
    for (const d = new Date(`${from}T00:00:00Z`); day(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      dayList.push(day(d));
    }
    const idxOfDay = new Map(dayList.map((d, i) => [d, i]));

    const teams = new Map<number, {
      teamId: number; teamName: string; league: string; country: string;
      followers: number; newFollowers: number; activeNow: number;
      altas: number; bajas: number; net: number;
      altasByDay: number[]; bajasByDay: number[]; activeByDay: number[];
    }>();
    const blank = (teamId: number) => ({
      teamId, teamName: `#${teamId}`, league: 'N/A', country: 'N/A',
      followers: 0, newFollowers: 0, activeNow: 0, altas: 0, bajas: 0, net: 0,
      altasByDay: dayList.map(() => 0), bajasByDay: dayList.map(() => 0),
      activeByDay: dayList.map(() => 0),
    });
    const get = (teamId: number) => {
      let t = teams.get(teamId);
      if (!t) { t = blank(teamId); teams.set(teamId, t); }
      return t;
    };

    for (const r of (followerRows as unknown) as Row[]) {
      const t = get(num(r.team_id));
      t.teamName = str(r.team_name);
      t.league = str(r.league);
      t.country = str(r.country);
      t.followers = num(r.followers);
      t.newFollowers = num(r.new_followers);
    }
    for (const r of (activeRows as unknown) as Row[]) get(num(r.team_id)).activeNow = num(r.active_now);

    const daily = dayList.map((d) => ({ day: d, altas: 0, bajas: 0, net: 0, active: 0 }));
    for (const r of (movementRows as unknown) as Row[]) {
      const t = get(num(r.team_id));
      const i = idxOfDay.get(day(r.day));
      if (i === undefined) continue;
      const altas = num(r.altas);
      const bajas = num(r.bajas);
      t.altasByDay[i] = altas;
      t.bajasByDay[i] = bajas;
      t.activeByDay[i] = num(r.active);
      t.altas += altas;
      t.bajas += bajas;
      t.net = t.altas - t.bajas;
      daily[i].altas += altas;
      daily[i].bajas += bajas;
      daily[i].net += altas - bajas;
      // Each Subscriber has exactly one favourite team, so team sums don't overlap.
      daily[i].active += num(r.active);
    }

    const all = [...teams.values()].sort((a, b) => b.followers - a.followers);
    const totals = {
      followers: all.reduce((s, t) => s + t.followers, 0),
      activeNow: all.reduce((s, t) => s + t.activeNow, 0),
      altas: all.reduce((s, t) => s + t.altas, 0),
      bajas: all.reduce((s, t) => s + t.bajas, 0),
      net: 0,
      teamsWithMovement: all.filter((t) => t.altas + t.bajas > 0).length,
    };
    totals.net = totals.altas - totals.bajas;

    return ok({ from, to, days: dayList, totals, daily, teams: all.slice(0, 80) });
  } catch (err) {
    return serverError(err);
  }
}
