import { google } from 'googleapis';
import type { ISheetsFetcher, SheetRow } from '@basket/core/ports/ISheetsFetcher';

export interface GoogleSheetsFetcherConfig {
  email: string;
  privateKey: string;
}

export class GoogleSheetsFetcher implements ISheetsFetcher {
  private readonly sheets: ReturnType<typeof google.sheets>;

  constructor(cfg: GoogleSheetsFetcherConfig) {
    const auth = new google.auth.JWT({
      email: cfg.email,
      key: cfg.privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async *streamRows(spreadsheetId: string, tab: string): AsyncGenerator<SheetRow, void, unknown> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:ZZ`,
      majorDimension: 'ROWS',
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const rows = res.data.values ?? [];
    if (rows.length === 0) return;

    let headerIdx = 0;
    while (headerIdx < rows.length && !looksLikeHeader(rows[headerIdx])) headerIdx++;
    const rawHeaders = (rows[headerIdx] ?? []).map((h, i) =>
      String(h ?? '').trim() || `col_${i}`,
    );
    const seen = new Map<string, number>();
    const headers = rawHeaders.map((h) => {
      const n = seen.get(h) ?? 0;
      seen.set(h, n + 1);
      return n === 0 ? h : `${h}_${n + 1}`;
    });

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      if (row.every((c) => c == null || String(c).trim() === '')) continue;
      const values: Record<string, string> = {};
      for (let c = 0; c < headers.length; c++) {
        values[headers[c]] = row[c] == null ? '' : String(row[c]);
      }
      yield { rowIndex: i + 1, values };
    }
  }

  async listTabs(spreadsheetId: string): Promise<string[]> {
    const res = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    });
    return (res.data.sheets ?? [])
      .map((s) => s.properties?.title ?? '')
      .filter((t) => t.length > 0);
  }
}

function looksLikeHeader(row: unknown[] | undefined): boolean {
  if (!row || row.length === 0) return false;
  const nonEmpty = row.filter((c) => c != null && String(c).trim() !== '');
  if (nonEmpty.length < 2) return false;
  if (!nonEmpty.every((c) => isNaN(Number(c)))) return false;
  // Require an ID-like column present so banner rows are skipped.
  return nonEmpty.some((c) => /^(id|jornada|fecha|dia|d[íi]a)$/i.test(String(c).trim()));
}
