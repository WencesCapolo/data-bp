'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import {
  usePartidosFilters,
  buildNacionalQS,
  buildIntlQS,
} from '../state/partidosFilterStore';
import type {
  PartidosNacionalMetaDTO,
  PartidosIntlMetaDTO,
} from '@partidos/core/dtos/MetaDTO';
import type {
  PartidosNacionalOverviewDTO,
  PartidosIntlOverviewDTO,
} from '@partidos/core/dtos/OverviewDTO';
import type {
  PartidosNacionalWeeklyDTO,
  PartidosIntlWeeklyDTO,
} from '@partidos/core/dtos/WeeklyDTO';
import type {
  PartidosNacionalMonthlyDTO,
  PartidosIntlMonthlyDTO,
} from '@partidos/core/dtos/MonthlyDTO';
import type {
  PartidosNacionalChannelsDTO,
  PartidosIntlChannelsDTO,
} from '@partidos/core/dtos/ChannelsDTO';
const SWR_OPTS = { revalidateOnFocus: false, dedupingInterval: 30_000 };

export function useNacionalMeta() {
  return useSWR<PartidosNacionalMetaDTO>('/api/partidos/meta', fetcher, SWR_OPTS);
}

export function useIntlMeta() {
  return useSWR<PartidosIntlMetaDTO>('/api/partidos/intl/meta', fetcher, SWR_OPTS);
}

export function useNacionalOverview() {
  const f = usePartidosFilters((s) => s.nacional);
  const qs = buildNacionalQS(f);
  return useSWR<PartidosNacionalOverviewDTO>(`/api/partidos/overview?${qs}`, fetcher, SWR_OPTS);
}

export function useNacionalWeekly() {
  const f = usePartidosFilters((s) => s.nacional);
  const qs = buildNacionalQS(f);
  return useSWR<PartidosNacionalWeeklyDTO>(`/api/partidos/weekly?${qs}`, fetcher, SWR_OPTS);
}

export function useNacionalMonthly() {
  const f = usePartidosFilters((s) => s.nacional);
  const qs = buildNacionalQS(f);
  return useSWR<PartidosNacionalMonthlyDTO>(`/api/partidos/monthly?${qs}`, fetcher, SWR_OPTS);
}

export function useNacionalChannels() {
  const f = usePartidosFilters((s) => s.nacional);
  const qs = buildNacionalQS(f);
  return useSWR<PartidosNacionalChannelsDTO>(`/api/partidos/channels?${qs}`, fetcher, SWR_OPTS);
}

export function useIntlOverview() {
  const f = usePartidosFilters((s) => s.intl);
  const qs = buildIntlQS(f);
  return useSWR<PartidosIntlOverviewDTO>(`/api/partidos/intl/overview?${qs}`, fetcher, SWR_OPTS);
}

export function useIntlWeekly() {
  const f = usePartidosFilters((s) => s.intl);
  const qs = buildIntlQS(f);
  return useSWR<PartidosIntlWeeklyDTO>(`/api/partidos/intl/weekly?${qs}`, fetcher, SWR_OPTS);
}

export function useIntlMonthly() {
  const f = usePartidosFilters((s) => s.intl);
  const qs = buildIntlQS(f);
  return useSWR<PartidosIntlMonthlyDTO>(`/api/partidos/intl/monthly?${qs}`, fetcher, SWR_OPTS);
}

export function useIntlChannels() {
  const f = usePartidosFilters((s) => s.intl);
  const qs = buildIntlQS(f);
  return useSWR<PartidosIntlChannelsDTO>(`/api/partidos/intl/channels?${qs}`, fetcher, SWR_OPTS);
}

