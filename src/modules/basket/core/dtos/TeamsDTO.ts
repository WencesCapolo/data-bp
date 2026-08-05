import type { DateRange } from './shared';

// One team in the Equipos master list. Followers describe the fanbase (every
// Subscriber whose favourite team this is, paying or not); altas/bajas describe
// Subscription movement attributed to that fanbase.
export interface TeamRankRow {
  teamId: number;
  teamName: string;
  league: string;
  teamCountry: string;
  // Every Subscriber whose promo team is this one, regardless of Subscription.
  followers: number;
  // Subscribers created inside the window whose promo team is this one.
  newFollowers: number;
  // Subscriptions active on the window's last day.
  activeSubs: number;
  // Summed over the window. An alta is a new or reactivated Subscriber, never a
  // renewal; a baja is the end of uninterrupted access.
  altas: number;
  bajas: number;
  net: number;
  // Pagos inside the window.
  payments: number;
  amount: number;
  uniquePayers: number;
}

export interface TeamsDTO {
  range: DateRange;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  totals: {
    teams: number;
    followers: number;
    activeSubs: number;
    altas: number;
    bajas: number;
    net: number;
    teamsWithMovement: number;
  };
  ranked: TeamRankRow[];
}

// Per-team drill-down: a dense daily series. `days` is ascending and gap-free;
// `altas`, `bajas` and `activeSubs` are aligned to it index by index.
export interface TeamDailyDTO {
  teamId: number;
  teamName: string;
  from: string;
  to: string;
  days: string[];
  altas: number[];
  bajas: number[];
  activeSubs: number[];
}
