import { google } from 'googleapis';
import type { IPartidosSheetsFetcher } from '@partidos/core/ports/IPartidosSheetsFetcher';

export interface GooglePartidosSheetsFetcherConfig {
  spreadsheetId: string;
  email: string;
  privateKey: string;
}

export class GooglePartidosSheetsFetcher implements IPartidosSheetsFetcher {
  private readonly sheets: ReturnType<typeof google.sheets>;

  constructor(private readonly cfg: GooglePartidosSheetsFetcherConfig) {
    const auth = new google.auth.JWT({
      email: cfg.email,
      key: decodeKey(cfg.privateKey),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async getValues(tab: string): Promise<string[][]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.cfg.spreadsheetId,
      range: tab,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const values = res.data.values ?? [];
    return values.map((row) => row.map((cell) => String(cell ?? '')));
  }
}

function decodeKey(raw: string): string {
  if (raw.includes('BEGIN PRIVATE KEY')) return raw.replace(/\\n/g, '\n');
  return Buffer.from(raw, 'base64').toString('utf-8');
}
