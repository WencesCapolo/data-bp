import { User, UserProps } from '../entities/User';

export interface IUserRepository {
  upsertMany(users: UserProps[]): Promise<number>;
  findById(id: number): Promise<User | null>;
  count(): Promise<number>;
  countByCountry(): Promise<Array<{ country: string; count: number }>>;
  getKnownIds(): Promise<Set<number>>;
}
