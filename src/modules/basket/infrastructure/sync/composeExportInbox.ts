// The SFTP inbox as a sync step, or nothing at all.
//
// `MP_SFTP_INBOX` unset means the step does not exist — the same shape
// `SYNC_FX_ENABLED` and the gateway credentials use, and the reason a laptop
// with no MercadoPago SFTP account still runs the whole sync.

import { DrizzleGatewayFeeRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayFeeRepository';
import { DrizzlePaymentUploadRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentUploadRepository';
import { IngestPaymentExportUseCase } from '@basket/core/use-cases/sync/IngestPaymentExportUseCase';
import { IngestExportInboxUseCase } from '@basket/core/use-cases/sync/IngestExportInboxUseCase';
import { FsExportInbox } from '@basket/infrastructure/exports/FsExportInbox';
import { isResolved, resolveExportSource } from '@basket/infrastructure/exports/resolveExportSource';

/** Days of `done/` kept. Monthly Exports are ~2 MB, so this is about the fuse on
 *  an unbounded directory, not about disk pressure today. */
const DEFAULT_RETENTION_DAYS = 30;

export function composeExportInboxIngest(
  uploadedBy: string,
): IngestExportInboxUseCase | null {
  const dir = process.env.MP_SFTP_INBOX;
  if (!dir) return null;

  return new IngestExportInboxUseCase({
    inbox: new FsExportInbox(dir),
    ingest: new IngestPaymentExportUseCase(new DrizzleGatewayFeeRepository()),
    uploads: new DrizzlePaymentUploadRepository(),
    resolve: async (file) => {
      const r = await resolveExportSource(file.path, file.name);
      return isResolved(r) ? { spec: r.spec, source: r.source } : { error: r.error, message: r.message };
    },
    uploadedBy,
    retentionDays: Number(process.env.MP_SFTP_DONE_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS),
  });
}
