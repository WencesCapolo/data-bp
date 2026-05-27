import { google } from "googleapis";

type Env = {
  spreadsheetId: string;
  serviceAccountEmail: string;
  privateKey: string;
};

export const NACIONAL_TAB = process.env.SHEET_TAB_NAME ?? "Ligas Argentinas";
export const INTL_TAB =
  process.env.SHEET_TAB_NAME_INTL ?? "Ligas Internacionales";

function readEnv(): Env {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!spreadsheetId || !serviceAccountEmail || !rawKey) {
    throw new Error(
      "Missing env: GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY",
    );
  }
  const privateKey = decodeKey(rawKey);
  return { spreadsheetId, serviceAccountEmail, privateKey };
}

function decodeKey(raw: string): string {
  if (raw.includes("BEGIN PRIVATE KEY")) return raw.replace(/\\n/g, "\n");
  return Buffer.from(raw, "base64").toString("utf-8");
}

export async function fetchSheetValues(tab: string): Promise<string[][]> {
  const env = readEnv();
  const auth = new google.auth.JWT({
    email: env.serviceAccountEmail,
    key: env.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.spreadsheetId,
    range: tab,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const values = res.data.values ?? [];
  return values.map((row) => row.map((cell) => String(cell ?? "")));
}
