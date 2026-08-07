import { z } from 'zod';
import type {
  AccessType,
  CommonFilters,
  DateRange,
  Granularity,
  SubType,
} from '@basket/core/dtos/shared';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const rangeKindSchema = z
  .enum(['yesterday', '7d', '30d', '90d', 'ytd', 'all', 'custom'])
  .default('30d');
export const granularitySchema = z.enum(['day', 'week', 'month']).default('day');
export const accessTypeSchema = z.enum(['real', 'voucher', 'antel']);
export const subTypeSchema = z.enum([
  'Free',
  'Mensual_Basico',
  'Mensual_Total',
  'Anual_Total',
  'Otros',
]);

const countriesParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v == null) return undefined;
    const arr = Array.isArray(v) ? v : v.split(',');
    const cleaned = arr.map((s) => s.trim()).filter((s) => s.length > 0);
    return cleaned.length > 0 ? cleaned : undefined;
  });

const commonFiltersShape = {
  countries: countriesParam,
  accessType: accessTypeSchema.optional(),
  subType: subTypeSchema.optional(),
};

function toFilters(v: {
  countries?: string[];
  accessType?: AccessType;
  subType?: SubType;
}): CommonFilters | undefined {
  const f: CommonFilters = {};
  if (v.countries && v.countries.length > 0) f.countries = v.countries;
  if (v.accessType) f.accessType = v.accessType;
  if (v.subType) f.subType = v.subType;
  return Object.keys(f).length > 0 ? f : undefined;
}

function toDateRange(v: { range: string; from?: string; to?: string }): DateRange {
  return v.range === 'custom'
    ? { kind: 'custom', from: v.from!, to: v.to! }
    : ({ kind: v.range } as DateRange);
}

const customRangeRefine = (
  v: { range: string; from?: string; to?: string },
  ctx: z.RefinementCtx,
) => {
  if (v.range === 'custom' && (!v.from || !v.to)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'range=custom requires from + to (YYYY-MM-DD)',
      path: ['range'],
    });
  }
};

export const RangeQuerySchema = z
  .object({
    range: rangeKindSchema,
    from: z.string().regex(ISO_DATE).optional(),
    to: z.string().regex(ISO_DATE).optional(),
  })
  .superRefine(customRangeRefine)
  .transform(toDateRange);

export const OverviewQuerySchema = z
  .object({
    asOf: z.string().regex(ISO_DATE).optional(),
    range: rangeKindSchema,
    from: z.string().regex(ISO_DATE).optional(),
    to: z.string().regex(ISO_DATE).optional(),
    ...commonFiltersShape,
  })
  .superRefine(customRangeRefine)
  .transform((v) => ({
    asOf: v.asOf,
    range: toDateRange(v),
    filters: toFilters(v),
  }));

export const EvolutionQuerySchema = z
  .object({
    range: rangeKindSchema,
    from: z.string().regex(ISO_DATE).optional(),
    to: z.string().regex(ISO_DATE).optional(),
    granularity: granularitySchema,
    ...commonFiltersShape,
  })
  .superRefine(customRangeRefine)
  .transform((v) => ({
    range: toDateRange(v),
    granularity: v.granularity as Granularity,
    filters: toFilters(v),
  }));

export const FinanceQuerySchema = z
  .object({
    range: rangeKindSchema,
    from: z.string().regex(ISO_DATE).optional(),
    to: z.string().regex(ISO_DATE).optional(),
    ...commonFiltersShape,
  })
  .superRefine(customRangeRefine)
  .transform((v) => ({
    range: toDateRange(v),
    filters: toFilters(v),
  }));

export const TeamsQuerySchema = z
  .object({
    range: rangeKindSchema,
    from: z.string().regex(ISO_DATE).optional(),
    to: z.string().regex(ISO_DATE).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    country: z.string().min(1).max(64).optional(),
    ...commonFiltersShape,
  })
  .superRefine(customRangeRefine)
  .transform((v) => ({
    range: toDateRange(v),
    limit: v.limit,
    country: v.country,
    filters: toFilters(v),
  }));

// Team 0 is the 'Sin equipo' bucket, a drillable row like any other team.
export const TeamIdSchema = z.coerce.number().int().nonnegative();

export const TeamDailyQuerySchema = z
  .object({
    range: rangeKindSchema,
    from: z.string().regex(ISO_DATE).optional(),
    to: z.string().regex(ISO_DATE).optional(),
    ...commonFiltersShape,
  })
  .superRefine(customRangeRefine)
  .transform((v) => ({
    range: toDateRange(v),
    filters: toFilters(v),
  }));

export function parseSearchParams(req: {
  nextUrl: { searchParams: URLSearchParams };
}): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(req.nextUrl.searchParams.keys())) {
    const all = req.nextUrl.searchParams.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}
