import type { IPartidosNacionalRepository } from '@partidos/core/ports/IPartidosNacionalRepository';
import type { IPartidosIntlRepository } from '@partidos/core/ports/IPartidosIntlRepository';
import type { IPartidosSyncStateRepository } from '@partidos/core/ports/IPartidosSyncStateRepository';
import type { IPartidosSheetsFetcher } from '@partidos/core/ports/IPartidosSheetsFetcher';
import type { PartidosSyncResultDTO } from '@partidos/core/dtos/PartidosSyncDTO';
import { parseRows } from '@partidos/lib/parser';
import { parseIntlRows } from '@partidos/lib/parser/indexIntl';

export interface SyncPartidosDeps {
  nacionalRepo: IPartidosNacionalRepository;
  intlRepo: IPartidosIntlRepository;
  syncState: IPartidosSyncStateRepository;
  sheets: IPartidosSheetsFetcher;
  nacionalTab: string;
  intlTab: string;
}

export class SyncPartidosUseCase {
  constructor(private readonly deps: SyncPartidosDeps) {}

  async execute(): Promise<PartidosSyncResultDTO> {
    const startedAt = new Date();
    try {
      const [nacionalValues, intlValues] = await Promise.all([
        this.deps.sheets.getValues(this.deps.nacionalTab),
        this.deps.sheets.getValues(this.deps.intlTab),
      ]);

      const nacionalRows = parseRows(nacionalValues);
      const intlRows = parseIntlRows(intlValues);

      const [countNacional, countIntl] = await Promise.all([
        this.deps.nacionalRepo.replaceAll(nacionalRows),
        this.deps.intlRepo.replaceAll(intlRows),
      ]);

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      await this.deps.syncState.update({
        lastSyncAt: finishedAt,
        lastCountNacional: countNacional,
        lastCountIntl: countIntl,
        lastError: null,
        lastDurationMs: durationMs,
      });

      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs,
        countNacional,
        countIntl,
      };
    } catch (err) {
      const finishedAt = new Date();
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.syncState.update({
        lastSyncAt: finishedAt,
        lastCountNacional: 0,
        lastCountIntl: 0,
        lastError: message,
        lastDurationMs: finishedAt.getTime() - startedAt.getTime(),
      });
      throw err;
    }
  }
}
