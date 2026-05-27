export interface PartidosWeekOption {
  key: string;
  monthYear: string;
  weekRange: string;
  weekStart: string;
}

export interface PartidosNacionalMetaDTO {
  seasons: string[];
  leagues: string[];
  controls: string[];
  months: string[];
  weeks: PartidosWeekOption[];
  latestSeason: string | null;
  latestMonth: string | null;
}

export interface PartidosIntlMetaDTO {
  seasons: string[];
  countries: string[];
  leagues: string[];
  months: string[];
  weeks: PartidosWeekOption[];
  latestSeason: string | null;
  latestMonth: string | null;
}
