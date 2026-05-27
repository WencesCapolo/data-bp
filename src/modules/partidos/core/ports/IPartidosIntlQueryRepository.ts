import type { PartidosIntlFilters } from '@partidos/core/dtos/shared';
import type { PartidosIntlMetaDTO } from '@partidos/core/dtos/MetaDTO';
import type { PartidosIntlOverviewDTO } from '@partidos/core/dtos/OverviewDTO';
import type { PartidosIntlWeeklyDTO } from '@partidos/core/dtos/WeeklyDTO';
import type { PartidosIntlMonthlyDTO } from '@partidos/core/dtos/MonthlyDTO';
import type { PartidosIntlChannelsDTO } from '@partidos/core/dtos/ChannelsDTO';

export interface IPartidosIntlQueryRepository {
  getMeta(): Promise<PartidosIntlMetaDTO>;
  getOverview(filters?: PartidosIntlFilters): Promise<PartidosIntlOverviewDTO>;
  getWeekly(filters?: PartidosIntlFilters): Promise<PartidosIntlWeeklyDTO>;
  getMonthly(filters?: PartidosIntlFilters): Promise<PartidosIntlMonthlyDTO>;
  getChannels(filters?: PartidosIntlFilters): Promise<PartidosIntlChannelsDTO>;
}
