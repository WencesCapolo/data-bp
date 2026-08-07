import type { CommonFilters, DateRange, Granularity } from '@basket/core/dtos/shared';
import type { OverviewDTO } from '@basket/core/dtos/OverviewDTO';
import type { EvolutionDTO } from '@basket/core/dtos/EvolutionDTO';
import type { TeamsDTO, TeamDailyDTO } from '@basket/core/dtos/TeamsDTO';
import type { FinanceDTO } from '@basket/core/dtos/FinanceDTO';
import type { RetentionDTO } from '@basket/core/dtos/RetentionDTO';
import type { DataQualityDTO } from '@basket/core/dtos/DataQualityDTO';
import type { MetaDTO } from '@basket/core/dtos/MetaDTO';

export interface IAnalyticsQueryRepository {
  getMeta(): Promise<MetaDTO>;
  getOverview(asOf?: Date, range?: DateRange, filters?: CommonFilters): Promise<OverviewDTO>;
  getEvolution(
    range: DateRange,
    granularity: Granularity,
    filters?: CommonFilters,
  ): Promise<EvolutionDTO>;
  getTeams(
    range: DateRange,
    opts?: { limit?: number; country?: string; filters?: CommonFilters },
  ): Promise<TeamsDTO>;
  getTeamDaily(
    teamId: number,
    range: DateRange,
    filters?: CommonFilters,
  ): Promise<TeamDailyDTO>;
  getFinance(range: DateRange, filters?: CommonFilters): Promise<FinanceDTO>;
  getRetention(range?: DateRange, filters?: CommonFilters): Promise<RetentionDTO>;
  getDataQuality(): Promise<DataQualityDTO>;
}
