import { CsvApiFetcher } from '@basket/infrastructure/csv/CsvApiFetcher';
import { DrizzleUserRepository } from '@basket/infrastructure/db/repositories/DrizzleUserRepository';
import { DrizzlePaymentRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentRepository';
import { DrizzleTeamRepository } from '@basket/infrastructure/db/repositories/DrizzleTeamRepository';
import { DrizzleSyncStateRepository } from '@basket/infrastructure/db/repositories/DrizzleSyncStateRepository';
import { DrizzleMaterializedViewRepository } from '@basket/infrastructure/db/repositories/DrizzleMaterializedViewRepository';
import { mapUserRow, mapPaymentRow, type UserCsvRow, type PaymentCsvRow } from '@basket/infrastructure/sync/csvMappers';
import { RunSyncUseCase } from '@basket/core/use-cases/sync/RunSyncUseCase';

export function composeRunSync(): RunSyncUseCase {
  const baseUrl = process.env.EXTERNAL_API_BASE;
  if (!baseUrl) throw new Error('EXTERNAL_API_BASE not set');

  const fetcher = new CsvApiFetcher({
    baseUrl,
    apiKey: process.env.EXTERNAL_API_KEY,
    delimiter: ';',
    sinceParam: process.env.EXTERNAL_SINCE_PARAM ?? 'since',
  });

  const users = new DrizzleUserRepository();
  const payments = new DrizzlePaymentRepository();
  const teams = new DrizzleTeamRepository();
  const syncState = new DrizzleSyncStateRepository();
  const matViews = new DrizzleMaterializedViewRepository();

  return new RunSyncUseCase({
    fetcher,
    users,
    payments,
    syncState,
    matViews,
    knownTeamIds: () => teams.getKnownIds(),
    knownUserIds: () => users.getKnownIds(),
    mapUserRow: (row, teamIds) => mapUserRow(row as unknown as UserCsvRow, teamIds),
    mapPaymentRow: (row, userIds) => mapPaymentRow(row as unknown as PaymentCsvRow, userIds),
    usersResource: process.env.EXTERNAL_USERS_PATH ?? 'users.csv',
    paymentsResource: process.env.EXTERNAL_PAYMENTS_PATH ?? 'payments.csv',
  });
}
