import type { UserProps } from '@basket/core/entities/User';
import type { PaymentProps } from '@basket/core/entities/Payment';
import type { PaymentUploadRow } from '@basket/core/dtos/PaymentUploadDTO';
import { normalizeStatusDetail } from '@basket/core/value-objects/PaymentStatus';

export interface UserCsvRow {
  id: string;
  idx: string;
  email: string;
  firstname: string;
  lastname: string;
  created: string;
  login: string;
  status: string;
  last_status: string;
  promo_team: string;
  promo_team_changed: string;
  play_token: string;
  roles: string;
  country: string;
  email_verified: string;
}

export interface PaymentCsvRow {
  id: string;
  idx: string;
  user_id: string;
  payment_email: string;
  platform_payment_id: string;
  platform: string;
  product_id: string;
  price_id: string;
  content_id: string;
  amount: string;
  currency: string;
  recurrent: string;
  expires: string;
  created: string;
  status: string;
  status_detail: string;
  keycode: string;
  payment_country: string;
}

function parseIntOrNull(v: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDateOrNull(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function emptyToNull(v: string): string | null {
  return v && v.length > 0 ? v : null;
}

/** Offset the Control Panel's wall clock runs on: -03:00 (Argentina/Uruguay, no DST). */
const PANEL_UTC_OFFSET_MS = -3 * 3_600_000;

const PANEL_DATE_RX = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parses the `dd/mm/yyyy HH:MM` stamps the Control Panel writes into a Pagos Export.
 *
 * Timezone: the Export omits any offset, while the (now dead) API CSVs carried an
 * explicit one — `2020-10-01T03:25:26-03:00` — which `new Date()` resolves to the
 * right instant on its own. To keep both paths on one clock we pin Export stamps to
 * that same `-03:00` instead of the host's local zone: the app runs on UTC servers,
 * so relying on local time would shift every Pago three hours later than it happened
 * and slide rows across day and month boundaries in the dashboards.
 */
export function parsePanelDate(value: string): Date | null {
  const m = (value ?? '').trim().match(PANEL_DATE_RX);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const hour = Number(hh);
  const minute = Number(min);
  const second = ss ? Number(ss) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  // Wall-clock instant first, then shifted onto the panel's offset.
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const wall = new Date(wallMs);
  // Rejects overflow like 31/02, which Date.UTC would roll into the next month.
  if (wall.getUTCMonth() + 1 !== month || wall.getUTCDate() !== day) return null;
  return new Date(wallMs - PANEL_UTC_OFFSET_MS);
}

const MS_PER_DAY = 86_400_000;

/** Expiry the Pagos Export does not carry: `created + Period days`. See ADR 0002. */
export function deriveExpiry(createdAt: Date, recurrentDays: number): Date {
  return new Date(createdAt.getTime() + recurrentDays * MS_PER_DAY);
}

/**
 * Maps one Pagos Export row (the hand-uploaded CSV) to a Payment.
 *
 * Differences from `mapPaymentRow`, which reads the old API CSV:
 * - `created` is panel-formatted, not ISO (see `parsePanelDate`).
 * - `expiresAt` is derived from Period, because the Export has no expiry column.
 * - the payment e-mail lives in `email`.
 * - `priceId`/`productId`/`contentId`/`idx`/`keycode` have no column here and stay
 *   null rather than being guessed; Tier is derived downstream from amount+Period.
 */
export function mapPaymentUploadRow(
  row: PaymentUploadRow,
  knownUserIds: Set<number>,
): PaymentProps | null {
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  const userId = Number(row.user_id);
  if (!Number.isFinite(userId) || !knownUserIds.has(userId)) return null;
  const createdAt = parsePanelDate(row.created);
  if (!createdAt) return null;
  const recurrent = parseIntOrNull(row.recurrent) ?? 0;
  const amount = parseFloat(row.amount);
  return {
    id,
    userId,
    paymentEmail: emptyToNull(row.email),
    platformPaymentId: emptyToNull(row.platform_payment_id),
    platform: parseIntOrNull(row.platform) ?? 0,
    productId: null,
    priceId: null,
    contentId: null,
    amount: Number.isFinite(amount) ? amount : 0,
    currency: row.currency ? row.currency.toUpperCase().slice(0, 10) : null,
    recurrent,
    expiresAt: deriveExpiry(createdAt, recurrent),
    createdAt,
    status: parseIntOrNull(row.status) ?? 0,
    statusDetail: normalizeStatusDetail(row.status_detail),
    keycode: null,
    // ISO-3166 numeric code as a string ('32', '858'); stored verbatim. Absent when
    // the Export drops the trailing empty field, leaving the row 14 columns wide.
    paymentCountry: emptyToNull(row.payment_country),
  };
}

export function mapUserRow(row: UserCsvRow, knownTeamIds: Set<number>): UserProps | null {
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  const createdAt = parseDateOrNull(row.created);
  if (!createdAt) return null;
  const promoTeamRaw = parseIntOrNull(row.promo_team);
  const promoTeamId = promoTeamRaw !== null && knownTeamIds.has(promoTeamRaw) ? promoTeamRaw : null;
  return {
    id,
    idx: emptyToNull(row.idx),
    email: emptyToNull(row.email),
    firstname: emptyToNull(row.firstname),
    lastname: emptyToNull(row.lastname),
    createdAt,
    loginAt: parseDateOrNull(row.login),
    status: parseIntOrNull(row.status) ?? 0,
    lastStatus: parseIntOrNull(row.last_status),
    promoTeamId,
    promoTeamChangedAt: parseDateOrNull(row.promo_team_changed),
    playToken: parseIntOrNull(row.play_token),
    roles: parseIntOrNull(row.roles),
    country: emptyToNull(row.country),
    emailVerified: row.email_verified === '1',
  };
}

export interface TournamentCsvRow {
  id: string;
  name: string;
  country: string;
}

export interface ContentCsvRow {
  id: string;
  idx: string;
  'title_es-ar': string;
  'summary_es-ar': string;
  image: string;
  created: string;
  updated: string;
  date: string;
  date_ends: string;
  date_server_spawns: string;
  date_server_goes_live: string;
  duration: string;
  status: string;
  type: string;
  match_id: string;
  venue: string;
  team_1: string;
  team_2: string;
  team_1_name: string;
  team_2_name: string;
  team_1_score: string;
  team_2_score: string;
  match_status: string;
  tournament: string;
  country: string;
  product_id: string;
  weight: string;
  views: string;
  views_users: string;
  views_seconds: string;
}

export function mapContentRow(row: ContentCsvRow): import('@basket/core/entities/Content').ContentProps | null {
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    idx: emptyToNull(row.idx),
    title: emptyToNull(row['title_es-ar']),
    summary: emptyToNull(row['summary_es-ar']),
    imageId: emptyToNull(row.image),
    createdAt: parseDateOrNull(row.created),
    updatedAt: parseDateOrNull(row.updated),
    date: parseDateOrNull(row.date),
    dateEnds: parseDateOrNull(row.date_ends),
    dateServerSpawns: parseDateOrNull(row.date_server_spawns),
    dateServerGoesLive: parseDateOrNull(row.date_server_goes_live),
    duration: parseIntOrNull(row.duration),
    status: parseIntOrNull(row.status),
    type: parseIntOrNull(row.type),
    matchId: emptyToNull(row.match_id),
    venue: emptyToNull(row.venue),
    team1: parseIntOrNull(row.team_1),
    team2: parseIntOrNull(row.team_2),
    team1Name: emptyToNull(row.team_1_name),
    team2Name: emptyToNull(row.team_2_name),
    team1Score: parseIntOrNull(row.team_1_score),
    team2Score: parseIntOrNull(row.team_2_score),
    matchStatus: emptyToNull(row.match_status),
    tournamentId: parseIntOrNull(row.tournament),
    country: emptyToNull(row.country),
    productId: parseIntOrNull(row.product_id),
    weight: parseIntOrNull(row.weight),
    views: parseIntOrNull(row.views),
    viewsUsers: parseIntOrNull(row.views_users),
    viewsSeconds: parseIntOrNull(row.views_seconds),
  };
}

export interface TeamLiveCsvRow {
  id: string;
  name: string;
  country: string;
}

export function mapTournamentRow(row: TournamentCsvRow): { id: number; name: string; country: string | null } | null {
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  const name = (row.name ?? '').trim();
  if (!name) return null;
  return { id, name, country: emptyToNull(row.country) };
}

export function mapTeamLiveRow(row: TeamLiveCsvRow): { id: number; teamName: string; country: string } | null {
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  const teamName = (row.name ?? '').trim();
  if (!teamName) return null;
  return { id, teamName, country: row.country?.trim() || '' };
}

export function mapPaymentRow(row: PaymentCsvRow, knownUserIds: Set<number>): PaymentProps | null {
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  const userId = Number(row.user_id);
  if (!Number.isFinite(userId) || !knownUserIds.has(userId)) return null;
  const createdAt = parseDateOrNull(row.created);
  const expiresAt = parseDateOrNull(row.expires);
  if (!createdAt || !expiresAt) return null;
  const amount = parseFloat(row.amount);
  return {
    id,
    userId,
    paymentEmail: emptyToNull(row.payment_email),
    platformPaymentId: emptyToNull(row.platform_payment_id),
    platform: parseIntOrNull(row.platform) ?? 0,
    productId: parseIntOrNull(row.product_id),
    priceId: parseIntOrNull(row.price_id),
    contentId: parseIntOrNull(row.content_id),
    amount: Number.isFinite(amount) ? amount : 0,
    currency: row.currency ? row.currency.toUpperCase().slice(0, 10) : null,
    recurrent: parseIntOrNull(row.recurrent) ?? 0,
    expiresAt,
    createdAt,
    status: parseIntOrNull(row.status) ?? 0,
    statusDetail: normalizeStatusDetail(row.status_detail),
    keycode: emptyToNull(row.keycode),
    paymentCountry: emptyToNull(row.payment_country),
  };
}
