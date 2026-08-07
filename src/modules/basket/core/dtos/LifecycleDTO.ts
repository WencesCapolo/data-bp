import type { DateRange } from './shared';

// The user-base funnel, as of the range's last day — except the two
// login-derived counts. `basket_users.login_at` holds only the *latest* login
// and is overwritten on every sync, so "activo" can only ever be answered for
// today; those two fields ignore the range and say so in the UI.
export interface LifecycleFunnel {
  totalUsers: number;
  verifiedUsers: number;
  everSubscribed: number;
  // login_at within 30 days of now, with no subscription covering today.
  activeNoSub: number;
  // login_at within 30 days of now, with no successful payment ever.
  neverSubscribed: number;
}

// One day of subscription movement, counted as altas — events, not a headcount.
// A user lands in exactly one of the three per day (precedence: nuevo >
// reactivación > renovación), so a day is also a distinct-user count; coarser
// buckets sum days and stay events. Measured over full history, the two
// readings differ only for someone who pays twice inside one bucket:
// `nuevos` is identical at every grain (a user is new on one day, ever), and
// `renovaciones` runs ~3% above distinct renewers at month grain.
export interface LifecyclePoint {
  day: string; // YYYY-MM-DD
  nuevos: number;
  reactivaciones: number;
  renovaciones: number;
  activeSubs: number;
}

export interface LifecycleDTO {
  range: DateRange;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  // True when accessType/subType is set: the funnel's user-side counts have no
  // such dimension and are reported unfiltered by it.
  accessFilterIgnoredOnUsers: boolean;
  funnel: LifecycleFunnel;
  series: LifecyclePoint[];
}
