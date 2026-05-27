import { DrizzlePartidosNacionalRepository } from '@partidos/infrastructure/db/repositories/DrizzlePartidosNacionalRepository';
import { DrizzlePartidosIntlRepository } from '@partidos/infrastructure/db/repositories/DrizzlePartidosIntlRepository';
import { DrizzlePartidosSyncStateRepository } from '@partidos/infrastructure/db/repositories/DrizzlePartidosSyncStateRepository';
import { GooglePartidosSheetsFetcher } from '@partidos/infrastructure/sheets/GooglePartidosSheetsFetcher';
import { SyncPartidosUseCase } from '@partidos/core/use-cases/sync/SyncPartidosUseCase';

export function composeSyncPartidos(): SyncPartidosUseCase {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!spreadsheetId || !email || !privateKey) {
    throw new Error(
      'Missing env: GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY',
    );
  }

  const sheets = new GooglePartidosSheetsFetcher({ spreadsheetId, email, privateKey });

  return new SyncPartidosUseCase({
    nacionalRepo: new DrizzlePartidosNacionalRepository(),
    intlRepo: new DrizzlePartidosIntlRepository(),
    syncState: new DrizzlePartidosSyncStateRepository(),
    sheets,
    nacionalTab: process.env.SHEET_TAB_NAME ?? 'Ligas Argentinas',
    intlTab: process.env.SHEET_TAB_NAME_INTL ?? 'Ligas Internacionales',
  });
}
