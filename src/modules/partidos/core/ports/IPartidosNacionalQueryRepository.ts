import type { PartidosNacionalFilters } from '@partidos/core/dtos/shared';
import type { PartidosNacionalMetaDTO } from '@partidos/core/dtos/MetaDTO';
import type { PartidosNacionalOverviewDTO } from '@partidos/core/dtos/OverviewDTO';
import type { PartidosNacionalWeeklyDTO } from '@partidos/core/dtos/WeeklyDTO';
import type { PartidosNacionalMonthlyDTO } from '@partidos/core/dtos/MonthlyDTO';
import type { PartidosNacionalChannelsDTO } from '@partidos/core/dtos/ChannelsDTO';

export interface IPartidosNacionalQueryRepository {
  getMeta(): Promise<PartidosNacionalMetaDTO>;
  getOverview(filters?: PartidosNacionalFilters): Promise<PartidosNacionalOverviewDTO>;
  getWeekly(filters?: PartidosNacionalFilters): Promise<PartidosNacionalWeeklyDTO>;
  getMonthly(filters?: PartidosNacionalFilters): Promise<PartidosNacionalMonthlyDTO>;
  getChannels(filters?: PartidosNacionalFilters): Promise<PartidosNacionalChannelsDTO>;
}
