export interface PartidosNacionalFilters {
  seasons?: string[];
  leagues?: string[];
  controls?: string[];
  monthFrom?: string | null;
  monthTo?: string | null;
  weeks?: string[];
}

export interface PartidosIntlFilters {
  seasons?: string[];
  countries?: string[];
  leagues?: string[];
  monthFrom?: string | null;
  monthTo?: string | null;
  weeks?: string[];
}
