import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { CommonFilters, DateRange } from '@basket/core/dtos/shared';
import type { TeamsDTO, TeamTrendDTO } from '@basket/core/dtos/TeamsDTO';

export class GetTeamsUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(
    range: DateRange,
    opts: { limit?: number; country?: string; filters?: CommonFilters } = {},
  ): Promise<TeamsDTO> {
    return this.repo.getTeams(range, opts);
  }
  async trend(teamId: number): Promise<TeamTrendDTO> {
    return this.repo.getTeamTrend(teamId);
  }
}
