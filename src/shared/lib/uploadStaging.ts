// Staging area for uploaded Cobros Exports.
//
// An Upload is written to disk before it is looked at, so neither the preview
// nor the sync ever holds the file in memory: production is a ~1 GB VPS and a
// full-history Export is tens of megabytes. The handle handed back to the
// browser is a random UUID, never a filename, and resolving a handle back to a
// path re-validates it so a crafted id cannot escape the staging directory.

import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';

/** Ceiling for an accepted Upload. A full-history Export is ~20 MB. */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/** Staged files older than this are swept; an Upload is confirmed in seconds. */
export const STAGED_TTL_MS = 30 * 60 * 1000;

const STAGING_DIR = path.join(os.tmpdir(), 'basket-uploads');

/** randomUUID() output, and nothing else. No dots, no separators, no traversal. */
const UPLOAD_ID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface StagedFile {
  uploadId: string;
  path: string;
  byteSize: number;
}

export class UploadTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`upload exceeds ${maxBytes} bytes`);
    this.name = 'UploadTooLargeError';
  }
}

/**
 * Resolve an upload id to its staged path, or null when the id is not one we
 * could have issued. Two independent guards: the id must be a bare UUID, and
 * the resolved path must sit directly inside the staging directory.
 */
export function resolveStagedPath(uploadId: string): string | null {
  if (!UPLOAD_ID_RX.test(uploadId)) return null;
  const dir = path.resolve(STAGING_DIR);
  const resolved = path.resolve(dir, uploadId);
  if (path.dirname(resolved) !== dir) return null;
  return resolved;
}

/**
 * Write a request body stream to a fresh staged file, counting bytes as they
 * go and aborting the moment the ceiling is crossed. The partial file is
 * removed on any failure, so a rejected Upload leaves nothing behind.
 */
export async function stageUpload(
  source: ReadableStream<Uint8Array>,
  maxBytes: number = MAX_UPLOAD_BYTES,
): Promise<StagedFile> {
  await mkdir(STAGING_DIR, { recursive: true });

  const uploadId = randomUUID();
  const filePath = resolveStagedPath(uploadId);
  if (!filePath) throw new Error('failed to allocate a staging path');

  const out = createWriteStream(filePath, { flags: 'wx' });
  let byteSize = 0;

  try {
    const reader = source.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        byteSize += value.byteLength;
        if (byteSize > maxBytes) throw new UploadTooLargeError(maxBytes);
        if (!out.write(value)) await once(out, 'drain');
      }
    } finally {
      reader.releaseLock?.();
    }
    await new Promise<void>((resolve, reject) => {
      out.on('error', reject);
      out.end(resolve);
    });
  } catch (err) {
    out.destroy();
    await rm(filePath, { force: true }).catch(() => {});
    throw err;
  }

  return { uploadId, path: filePath, byteSize };
}

/** First bytes of a staged file, for sniffing and for the header line. */
export async function readStagedHead(filePath: string, bytes = 8 * 1024): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export type BinarySignature = 'xlsx' | 'xls' | 'binary';

/**
 * Detect content that cannot be a CSV, regardless of the filename. An .xlsx is
 * a ZIP container (`PK\x03\x04`) and the legacy .xls is an OLE2 compound file,
 * and both are routinely saved with a .csv extension by mistake.
 */
export function sniffBinary(head: Buffer): BinarySignature | null {
  if (head.length === 0) return null;
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    return 'xlsx';
  }
  const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (head.length >= 8 && head.subarray(0, 8).equals(ole2)) return 'xls';
  // A NUL byte in the first block means this is not a text file.
  if (head.subarray(0, Math.min(head.length, 1024)).includes(0)) return 'binary';
  return null;
}

/**
 * What the preview learned about an Upload, kept next to the staged file so the
 * provenance row is written from what the server measured rather than from what
 * the browser echoes back. Best-effort: a restart between preview and confirm
 * loses it, and the caller falls back to the request body.
 */
export interface StagedUploadMeta {
  filename: string;
  byteSize: number;
  rowTotal: number;
  windowFrom: string | null;
  windowTo: string | null;
  rememberedAt: number;
}

const stagedMeta = new Map<string, StagedUploadMeta>();

export function rememberUploadMeta(
  uploadId: string,
  meta: Omit<StagedUploadMeta, 'rememberedAt'>,
): void {
  if (!UPLOAD_ID_RX.test(uploadId)) return;
  const cutoff = Date.now() - STAGED_TTL_MS;
  for (const [id, entry] of stagedMeta) {
    if (entry.rememberedAt < cutoff) stagedMeta.delete(id);
  }
  stagedMeta.set(uploadId, { ...meta, rememberedAt: Date.now() });
}

/** Reads and forgets the metadata for an Upload. Single-use, like the handle. */
export function takeUploadMeta(uploadId: string): StagedUploadMeta | null {
  const meta = stagedMeta.get(uploadId) ?? null;
  stagedMeta.delete(uploadId);
  return meta;
}

/** Delete one staged file. Safe to call twice; never throws. */
export async function deleteStagedFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true }).catch(() => {});
}

/** Delete by handle. Unknown or malformed ids are a no-op. */
export async function deleteStagedUpload(uploadId: string): Promise<void> {
  const filePath = resolveStagedPath(uploadId);
  if (filePath) await deleteStagedFile(filePath);
}

/**
 * Remove staged files left behind by Uploads that were previewed and never
 * confirmed. Called opportunistically at the start of an Upload.
 */
export async function sweepStagedFiles(ttlMs: number = STAGED_TTL_MS): Promise<number> {
  let removed = 0;
  let names: string[];
  try {
    names = await readdir(STAGING_DIR);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - ttlMs;
  for (const name of names) {
    if (!UPLOAD_ID_RX.test(name)) continue;
    const filePath = path.join(STAGING_DIR, name);
    try {
      const info = await stat(filePath);
      if (info.mtimeMs < cutoff) {
        await rm(filePath, { force: true });
        removed += 1;
      }
    } catch {
      // Raced with another sweep or another process; nothing to do.
    }
  }
  return removed;
}
