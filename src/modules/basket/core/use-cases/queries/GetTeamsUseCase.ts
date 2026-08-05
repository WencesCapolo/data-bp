import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { CommonFilters, DateRange } from '@basket/core/dtos/shared';
import type { TeamsDTO, TeamDailyDTO } from '@basket/core/dtos/TeamsDTO';

export class GetTeamsUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(
    range: DateRange,
    opts: { limit?: number; country?: string; filters?: CommonFilters } = {},
  ): Promise<TeamsDTO> {
    return this.repo.getTeams(range, opts);
  }
  async daily(teamId: number, range: DateRange, filters?: CommonFilters): Promise<TeamDailyDTO> {
    return this.repo.getTeamDaily(teamId, range, filters);
  }
}
