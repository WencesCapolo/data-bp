import { z } from 'zod';
import type { DateRange, Granularity } from '@basket/core/dtos/shared';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const rangeKindSchema = z.enum(['30d', '90d', 'ytd', 'all', 'custom']).default('30d');
export const granularitySchema = z.enum(['day', 'week', 'month']).default('day');

export const RangeQuerySchema = z
  .object({
    range: rangeKindSchema,
    from: z.string().regex(ISO_DATE).optional(),
    to: z.string().regex(ISO_DATE).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.range === 'custom' && (!v.from || !v.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'range=custom requires from + to (YYYY-MM-DD)',
        path: ['range'],
      });
    }
  })
  .transform((v): DateRange =>
    v.range === 'custom'
      ? { kind: 'custom', from: v.from!, to: v.to! }
      : { kind: v.range },
  );

export const OverviewQuerySchema = z.object({
  asOf: z.string().regex(ISO_DATE).optional(),
});

export const EvolutionQuerySchema = z
  .object({
    range: rangeKindSchema,
    from: z.string().regex(ISO_DATE).optional(),
    to: z.string().regex(ISO_DATE).optional(),
    granularity: granularitySchema,
  })
  .superRefine((v, ctx) => {
    if (v.range === 'custom' && (!v.from || !v.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'range=custom requires from + to',
        path: ['range'],
      });
    }
  })
  .transform((v) => ({
    range:
      v.range === 'custom'
        ? ({ kind: 'custom', from: v.from!, to: v.to! } as DateRange)
        : ({ kind: v.range } as DateRange),
    granularity: v.granularity as Granularity,
  }));

export const TeamsQuerySchema = z
  .object({
    range: rangeKindSchema,
    from: z.string().regex(ISO_DATE).optional(),
    to: z.string().regex(ISO_DATE).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    country: z.string().min(1).max(64).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.range === 'custom' && (!v.from || !v.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'range=custom requires from + to',
        path: ['range'],
      });
    }
  })
  .transform((v) => ({
    range:
      v.range === 'custom'
        ? ({ kind: 'custom', from: v.from!, to: v.to! } as DateRange)
        : ({ kind: v.range } as DateRange),
    limit: v.limit,
    country: v.country,
  }));

export const TeamIdSchema = z.coerce.number().int().positive();

export function parseSearchParams(req: { nextUrl: { searchParams: URLSearchParams } }): Record<string, string> {
  return Object.fromEntries(req.nextUrl.searchParams);
}
