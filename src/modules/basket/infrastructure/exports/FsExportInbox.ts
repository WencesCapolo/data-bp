import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { IExportInbox, InboxFile } from '@basket/core/ports/IExportInbox';

/**
 * Files MercadoPago's SFTP leaves behind that are not Exports: dotfiles, partial
 * uploads, and the probe the panel's *Probar conexión* writes — a 12-byte
 * `CONNECTION-CHECK-FILE.csv` reading `test-content`, re-created every time
 * somebody tests the connection. Ingesting it would cost one `bad_header`
 * rejection and one provenance row per test.
 */
const IGNORED = /^\.|\.(part|tmp|filepart)$/i;
const PROBE = /^connection-check-file\b/i;

/**
 * The inbox as a directory on the box: `/var/lib/mp-sftp/inbox`, with `done/`
 * beside the files rather than under a sibling of the jail, so the whole feature
 * is one subtree to inspect or delete.
 *
 * The analytics pm2 app runs as root, which is why a 0700 directory owned by
 * `mpreport` is readable at all. If that ever changes, the fix is a shared group
 * on the directory, not a looser mode — see the handoff.
 */
export class FsExportInbox implements IExportInbox {
  readonly origin: string;
  private readonly doneDir: string;

  constructor(private readonly dir: string) {
    this.origin = dir;
    this.doneDir = join(dir, 'done');
  }

  async list(): Promise<InboxFile[]> {
    const names = await readdir(this.dir).catch((err) => {
      // A missing or unreadable inbox is a configuration fact, not a crash: the
      // step is switched on by an env var that can point at a directory MP has
      // not created yet.
      throw new Error(`inbox ${this.dir} unreadable: ${(err as Error).message}`);
    });

    const files: InboxFile[] = [];
    for (const name of names) {
      if (IGNORED.test(name) || PROBE.test(name)) continue;
      const path = join(this.dir, name);
      // A directory here is `done/` or something a human left; either way it is
      // not a file to ingest.
      const info = await stat(path).catch(() => null);
      if (!info || !info.isFile()) continue;
      files.push({ name, path, byteSize: info.size, modifiedAt: info.mtime });
    }
    // Oldest first, so a month that arrived late is ingested before the one that
    // arrived after it. The mirror is keyed by the Provider's id, so order only
    // decides which file's version of a row survives — the newest, this way.
    return files.sort((a, b) => a.modifiedAt.getTime() - b.modifiedAt.getTime());
  }

  async markDone(file: InboxFile): Promise<void> {
    await mkdir(this.doneDir, { recursive: true });
    // Same name in `done/`: provenance already answers "did we ingest this", so
    // a stamped name would only make the directory harder to read. A second file
    // of the same name overwrites the first, which is what re-delivery means.
    await rename(file.path, join(this.doneDir, file.name));
  }

  async prune(retentionDays: number): Promise<number> {
    if (retentionDays <= 0) return 0;
    const cutoff = Date.now() - retentionDays * 86_400_000;
    const names = await readdir(this.doneDir).catch(() => [] as string[]);
    let removed = 0;
    for (const name of names) {
      const path = join(this.doneDir, name);
      const info = await stat(path).catch(() => null);
      if (!info || !info.isFile() || info.mtimeMs >= cutoff) continue;
      await rm(path, { force: true }).catch(() => {});
      removed += 1;
    }
    return removed;
  }
}
