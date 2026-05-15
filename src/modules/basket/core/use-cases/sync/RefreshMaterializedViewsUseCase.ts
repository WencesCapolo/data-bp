import type {
  IMaterializedViewRepository,
  RefreshResult,
} from '@basket/core/ports/IMaterializedViewRepository';

export interface RefreshInput {
  /** false on first run (no unique index populated yet); true after */
  concurrent: boolean;
}

export class RefreshMaterializedViewsUseCase {
  constructor(private readonly repo: IMaterializedViewRepository) {}

  async execute(input: RefreshInput): Promise<RefreshResult[]> {
    return this.repo.refreshAll(input.concurrent);
  }
}
