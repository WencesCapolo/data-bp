import { z } from 'zod';
import type {
  PartidosNacionalFilters,
  PartidosIntlFilters,
} from '@partidos/core/dtos/shared';

const MONTH_YEAR = /^\d{4}-\d{2}$/;

const csvParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v == null) return undefined;
    const arr = Array.isArray(v) ? v : v.split(',');
    const cleaned = arr.map((s) => s.trim()).filter((s) => s.length > 0);
    return cleaned.length > 0 ? cleaned : undefined;
  });

const monthYearParam = z
  .string()
  .regex(MONTH_YEAR)
  .optional()
  .transform((v) => v ?? null);

export const NacionalFiltersSchema = z
  .object({
    seasons: csvParam,
    leagues: csvParam,
    controls: csvParam,
    monthFrom: monthYearParam,
    monthTo: monthYearParam,
    weeks: csvParam,
  })
  .transform((v): PartidosNacionalFilters => ({
    seasons: v.seasons,
    leagues: v.leagues,
    controls: v.controls,
    monthFrom: v.monthFrom,
    monthTo: v.monthTo,
    weeks: v.weeks,
  }));

export const IntlFiltersSchema = z
  .object({
    seasons: csvParam,
    countries: csvParam,
    leagues: csvParam,
    monthFrom: monthYearParam,
    monthTo: monthYearParam,
    weeks: csvParam,
  })
  .transform((v): PartidosIntlFilters => ({
    seasons: v.seasons,
    countries: v.countries,
    leagues: v.leagues,
    monthFrom: v.monthFrom,
    monthTo: v.monthTo,
    weeks: v.weeks,
  }));
