import type { FixtureMatchProps } from '@basket/core/entities/FixtureMatch';

export interface IFixtureMatchRepository {
  upsertMany(rows: FixtureMatchProps[]): Promise<number>;
  count(): Promise<number>;
}
