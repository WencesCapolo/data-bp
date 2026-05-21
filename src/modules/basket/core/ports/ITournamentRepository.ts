import type { Tournament, TournamentProps } from '@basket/core/entities/Tournament';

export interface ITournamentRepository {
  upsertMany(tournaments: TournamentProps[]): Promise<number>;
  findById(id: number): Promise<Tournament | null>;
  count(): Promise<number>;
  getKnownIds(): Promise<Set<number>>;
}
