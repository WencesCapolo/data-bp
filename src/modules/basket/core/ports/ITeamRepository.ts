import { Team, TeamProps } from '../entities/Team';

export interface TeamLiveProps {
  id: number;
  teamName: string;
  country: string;
}

export interface ITeamRepository {
  upsertMany(teams: TeamProps[]): Promise<number>;
  upsertManyFromLive(teams: TeamLiveProps[]): Promise<number>;
  findById(id: number): Promise<Team | null>;
  findAll(): Promise<Team[]>;
  getKnownIds(): Promise<Set<number>>;
  count(): Promise<number>;
}
