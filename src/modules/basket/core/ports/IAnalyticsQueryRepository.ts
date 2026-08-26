import type { CommonFilters, DateRange, Granularity } from '@basket/core/dtos/shared';
import type { OverviewDTO } from '@basket/core/dtos/OverviewDTO';
import type { EvolutionDTO } from '@basket/core/dtos/EvolutionDTO';
import type { TeamsDTO, TeamDailyDTO } from '@basket/core/dtos/TeamsDTO';
import type { FinanceDTO } from '@basket/core/dtos/FinanceDTO';
import type { EconomiaDTO } from '@basket/core/dtos/EconomiaDTO';
import type { ContenidoDTO } from '@basket/core/dtos/ContenidoDTO';
import type { GatewayNetDTO } from '@basket/core/dtos/GatewayNetDTO';
import type { RetentionDTO } from '@basket/core/dtos/RetentionDTO';
import type { LifecycleDTO } from '@basket/core/dtos/LifecycleDTO';
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
  /** /financiero · Economía: gross from our Pagos + net from the gateway mirrors. */
  getEconomia(range: DateRange, filters?: CommonFilters): Promise<EconomiaDTO>;
  /**
   * /financiero · Contenido: the catalogue and its audience.
   *
   * Takes its own from/to and its own country instead of `DateRange` and
   * `CommonFilters` on purpose. Content country is where a match was played;
   * the shared filter's country is where a Subscriber pays from. Sharing the
   * parameter would silently answer a different question.
   */
  getContenido(opts: { from?: string; to?: string; country?: string }): Promise<ContenidoDTO>;
  getGatewayNet(range: DateRange, filters?: CommonFilters): Promise<GatewayNetDTO>;
  getRetention(range?: DateRange, filters?: CommonFilters): Promise<RetentionDTO>;
  getLifecycle(range: DateRange, filters?: CommonFilters): Promise<LifecycleDTO>;
  getDataQuality(): Promise<DataQualityDTO>;
}
