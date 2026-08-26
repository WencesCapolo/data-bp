/**
 * A directory Provider Exports arrive in on their own.
 *
 * MercadoPago's report centre pushes the *all transactions* report to an SFTP
 * account on our box (docs/handoff/mercadopago-sftp-all-transactions.md, step
 * 3); nothing calls us, so the ingest walks the directory instead. A port rather
 * than `fs` calls inside the use case for the usual reason: the use case is
 * where "already ingested", "move to done" and "never fatal" live, and none of
 * that should need a real filesystem to be exercised.
 */
export interface InboxFile {
  /** Name as it arrived. This is the key provenance answers "already ingested" by. */
  name: string;
  /** Whatever the adapter needs to open it. A path, for the filesystem one. */
  path: string;
  byteSize: number;
  /** Modification time, used only to order the oldest file first. */
  modifiedAt: Date;
}

export interface IExportInbox {
  /** For the provenance row and the log line: which inbox this is. */
  readonly origin: string;
  /** Files waiting, oldest first. Never includes what is already in `done/`. */
  list(): Promise<InboxFile[]>;
  /** Moves one file out of the way. Failures stay where they are on purpose. */
  markDone(file: InboxFile): Promise<void>;
  /** Deletes files in `done/` older than `retentionDays`. Returns how many. */
  prune(retentionDays: number): Promise<number>;
}
