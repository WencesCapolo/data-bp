// The Contenido view of /financiero: what the catalogue published, how much of
// it was watched, and how that audience moves against the subscriber base.
//
// Two things about this DTO are not obvious from its field names.
//
// **It counts a filtered catalogue, not every row in `basket_content`.** The
// prototype kept only `status = 1` rows averaging at least 60 seconds per view,
// dropping trailers, aborted streams and test emissions — 25,465 rows become
// 20,462. Reproducing the figures means reproducing the filter, so `catalogue`
// carries it as data: what was asked for, what survived, what was dropped.
//
// **Content country is not subscriber country.** `byCountry` is where a match
// was played, not where the person watching it pays from, so it must never be
// fed by the shared country filter that the rest of /financiero uses. The two
// numbers disagree for good reason and adding them means nothing.

/** The catalogue filter, reported rather than assumed. */
export interface CatalogueFilter {
  /** Only published content counts. `basket_content.status = 1`. */
  status: number;
  /** Rows averaging fewer seconds per view than this are dropped. */
  minAvgSecondsPerView: number;
  rowsInRange: number;
  rowsKept: number;
  rowsDroppedStatus: number;
  rowsDroppedShort: number;
}

export interface ContenidoTotals {
  contentCount: number;
  /** Rows carrying both team names — a real match, not a programme or a highlight. */
  matchesComplete: number;
  views: number;
  users: number;
  /** Sum of view-seconds. Negative values are excluded, not clamped to the row. */
  seconds: number;
  dateMin: string;
  dateMax: string;
}

export interface ContenidoMonthPoint {
  month: string;
  views: number;
  users: number;
  seconds: number;
  count: number;
  matches: number;
}

export interface ContenidoCountryRow {
  country: string;
  views: number;
  users: number;
  count: number;
  matches: number;
}

export interface ContenidoTournamentRow {
  tournamentId: number;
  name: string;
  countryMaster: string;
  views: number;
  users: number;
  count: number;
  matches: number;
}

export interface ContenidoTeamRow {
  team: string;
  views: number;
  users: number;
  count: number;
}

export interface ContenidoTopRow {
  date: string;
  title: string;
  team1: string;
  team2: string;
  tournamentName: string;
  country: string;
  views: number;
  users: number;
}

/**
 * One of the days that drew the most views, with the Pagos that landed the same
 * day. `newSubs` and `reactivated` are the two kinds of alta; a day with neither
 * reports zeros, which is a measurement — the day is in the window either way.
 */
export interface ContenidoEventDayRow extends ContenidoTopRow {
  newSubs: number;
  reactivated: number;
}

/** Subscribers active on the last day of the month, from `basket_mat_daily_active`. */
export interface ContenidoActiveMonthPoint {
  month: string;
  active: number;
}

export interface ContenidoDTO {
  from: string;
  to: string;
  /** Content country asked for, or null for every country. */
  country: string | null;
  catalogue: CatalogueFilter;
  totals: ContenidoTotals;
  monthly: ContenidoMonthPoint[];
  byCountry: ContenidoCountryRow[];
  byTournament: ContenidoTournamentRow[];
  /** Tournaments by match count — real matches only, so it is not `byTournament`. */
  byLeague: ContenidoTournamentRow[];
  byTeam: ContenidoTeamRow[];
  topViews: ContenidoTopRow[];
  topEventDays: ContenidoEventDayRow[];
  monthlyActive: ContenidoActiveMonthPoint[];
  /** Every content country in the catalogue, for the picker — not just this range's. */
  countries: string[];
}
