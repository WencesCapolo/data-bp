import type { UserProps } from '@basket/core/entities/User';
import type { PaymentProps } from '@basket/core/entities/Payment';

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
    idx: emptyToNull(row.idx),
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
    statusDetail: emptyToNull(row.status_detail),
    keycode: emptyToNull(row.keycode),
    paymentCountry: emptyToNull(row.payment_country),
  };
}
