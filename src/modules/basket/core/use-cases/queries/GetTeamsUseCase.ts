import type { IAnalyticsQueryRepository } from '@basket/core/ports/IAnalyticsQueryRepository';
import type { DateRange } from '@basket/core/dtos/shared';
import type { TeamsDTO, TeamTrendDTO } from '@basket/core/dtos/TeamsDTO';

export class GetTeamsUseCase {
  constructor(private readonly repo: IAnalyticsQueryRepository) {}
  async execute(range: DateRange, limit = 50, country?: string): Promise<TeamsDTO> {
    return this.repo.getTeams(range, limit, country);
  }
  async trend(teamId: number): Promise<TeamTrendDTO> {
    return this.repo.getTeamTrend(teamId);
  }
}
