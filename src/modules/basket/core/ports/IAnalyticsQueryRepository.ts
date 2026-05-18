import type { DateRange, Granularity } from '@basket/core/dtos/shared';
import type { OverviewDTO } from '@basket/core/dtos/OverviewDTO';
import type { EvolutionDTO } from '@basket/core/dtos/EvolutionDTO';
import type { TeamsDTO, TeamTrendDTO } from '@basket/core/dtos/TeamsDTO';
import type { FinanceDTO } from '@basket/core/dtos/FinanceDTO';
import type { RetentionDTO } from '@basket/core/dtos/RetentionDTO';
import type { DataQualityDTO } from '@basket/core/dtos/DataQualityDTO';
import type { MetaDTO } from '@basket/core/dtos/MetaDTO';

export interface IAnalyticsQueryRepository {
  getMeta(): Promise<MetaDTO>;
  getOverview(asOf?: Date): Promise<OverviewDTO>;
  getEvolution(range: DateRange, granularity: Granularity): Promise<EvolutionDTO>;
  getTeams(range: DateRange, limit?: number, country?: string): Promise<TeamsDTO>;
  getTeamTrend(teamId: number): Promise<TeamTrendDTO>;
  getFinance(range: DateRange): Promise<FinanceDTO>;
  getRetention(): Promise<RetentionDTO>;
  getDataQuality(): Promise<DataQualityDTO>;
}
