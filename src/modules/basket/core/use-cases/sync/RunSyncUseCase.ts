import type { ICsvFetcher } from '@basket/core/ports/ICsvFetcher';
import type { IUserRepository } from '@basket/core/ports/IUserRepository';
import type { IPaymentRepository } from '@basket/core/ports/IPaymentRepository';
import type { ISyncStateRepository } from '@basket/core/ports/ISyncStateRepository';
import type { IMaterializedViewRepository, RefreshResult } from '@basket/core/ports/IMaterializedViewRepository';
import type { UserProps } from '@basket/core/entities/User';
import type { PaymentProps } from '@basket/core/entities/Payment';
import { LoadUsersFromCsvUseCase } from './LoadUsersFromCsvUseCase';
import { LoadPaymentsFromCsvUseCase } from './LoadPaymentsFromCsvUseCase';
import { RefreshMaterializedViewsUseCase } from './RefreshMaterializedViewsUseCase';

export interface RunSyncDeps {
  fetcher: ICsvFetcher;
  users: IUserRepository;
  payments: IPaymentRepository;
  syncState: ISyncStateRepository;
  matViews: IMaterializedViewRepository;
  knownTeamIds: () => Promise<Set<number>>;
  knownUserIds: () => Promise<Set<number>>;
  mapUserRow: (row: Record<string, string>, knownTeamIds: Set<number>) => UserProps | null;
  mapPaymentRow: (row: Record<string, string>, knownUserIds: Set<number>) => PaymentProps | null;
  usersResource?: string;
  paymentsResource?: string;
}

export interface RunSyncResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  syncedUsers: number;
  syncedPayments: number;
  refreshes: RefreshResult[];
}

export class RunSyncUseCase {
  constructor(private readonly deps: RunSyncDeps) {}

  async execute(): Promise<RunSyncResult> {
    const startedAt = new Date();
    const usersResource = this.deps.usersResource ?? 'users.csv';
    const paymentsResource = this.deps.paymentsResource ?? 'payments.csv';

    const lastUsers = await this.deps.syncState.getLastSync('users');
    const lastPayments = await this.deps.syncState.getLastSync('payments');

    const teamIds = await this.deps.knownTeamIds();

    const userIdsSeen = new Set<number>();
    const usersStream = this.mapUsers(usersResource, lastUsers ?? undefined, teamIds, userIdsSeen);
    const usersResult = await new LoadUsersFromCsvUseCase(this.deps.users).execute({ rows: usersStream });

    const runAt = new Date();
    await this.deps.syncState.updateLastSync('users', runAt, await this.deps.users.count());

    const userIds = await this.deps.knownUserIds();
    const paymentsStream = this.mapPayments(paymentsResource, lastPayments ?? undefined, userIds);
    const paymentsResult = await new LoadPaymentsFromCsvUseCase(this.deps.payments).execute({ rows: paymentsStream });

    await this.deps.syncState.updateLastSync('payments', runAt, await this.deps.payments.count());

    const refreshes = await new RefreshMaterializedViewsUseCase(this.deps.matViews).execute({ concurrent: true });

    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      syncedUsers: usersResult.inserted,
      syncedPayments: paymentsResult.inserted,
      refreshes,
    };
  }

  private async *mapUsers(
    resource: string,
    since: Date | undefined,
    teamIds: Set<number>,
    seen: Set<number>,
  ): AsyncGenerator<UserProps> {
    for await (const row of this.deps.fetcher.streamRows<Record<string, string>>(resource, { since })) {
      const mapped = this.deps.mapUserRow(row, teamIds);
      if (mapped) {
        seen.add(mapped.id);
        yield mapped;
      }
    }
  }

  private async *mapPayments(
    resource: string,
    since: Date | undefined,
    userIds: Set<number>,
  ): AsyncGenerator<PaymentProps> {
    for await (const row of this.deps.fetcher.streamRows<Record<string, string>>(resource, { since })) {
      const mapped = this.deps.mapPaymentRow(row, userIds);
      if (mapped) yield mapped;
    }
  }
}
