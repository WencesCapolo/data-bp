import { Team, TeamProps } from '../entities/Team';

export interface ITeamRepository {
  upsertMany(teams: TeamProps[]): Promise<number>;
  findById(id: number): Promise<Team | null>;
  findAll(): Promise<Team[]>;
  getKnownIds(): Promise<Set<number>>;
}
