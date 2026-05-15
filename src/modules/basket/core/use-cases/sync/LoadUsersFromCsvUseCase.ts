import type { UserProps } from '@basket/core/entities/User';
import type { IUserRepository } from '@basket/core/ports/IUserRepository';

const BATCH_SIZE = 500;

export interface LoadUsersInput {
  rows: AsyncIterable<UserProps>;
  onProgress?: (loaded: number) => void;
}

export interface LoadUsersResult {
  inserted: number;
  rejected: number;
}

export class LoadUsersFromCsvUseCase {
  constructor(private readonly users: IUserRepository) {}

  async execute(input: LoadUsersInput): Promise<LoadUsersResult> {
    let buffer: UserProps[] = [];
    let inserted = 0;

    for await (const row of input.rows) {
      buffer.push(row);
      if (buffer.length >= BATCH_SIZE) {
        inserted += await this.users.upsertMany(buffer);
        input.onProgress?.(inserted);
        buffer = [];
      }
    }
    if (buffer.length > 0) {
      inserted += await this.users.upsertMany(buffer);
      input.onProgress?.(inserted);
    }
    return { inserted, rejected: 0 };
  }
}
