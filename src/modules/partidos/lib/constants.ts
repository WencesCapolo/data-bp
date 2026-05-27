export const LEAGUES = [
  "LNB",
  "LA",
  "LDD",
  "LFEM",
  "LFED_M",
  "LIGA_METRO",
] as const;

export type League = (typeof LEAGUES)[number];

export const ORGS = ["ADC", "CAB"] as const;
export type Org = (typeof ORGS)[number];

export const LEAGUE_ORG: Record<League, Org> = {
  LNB: "ADC",
  LA: "ADC",
  LDD: "ADC",
  LFEM: "ADC",
  LFED_M: "CAB",
  LIGA_METRO: "CAB",
};

export const LEAGUE_LABEL: Record<League, string> = {
  LNB: "LNB",
  LA: "Liga Argentina",
  LDD: "Liga de Desarrollo",
  LFEM: "Liga Femenina",
  LFED_M: "Liga Federal Masc.",
  LIGA_METRO: "Liga Metropolitana",
};

export const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

export const HEADER_ROW_COUNT = 5;
export const HEADER_ROW_COUNT_INTL = 6;
export const SEASON_BANNER_PATTERN = /^\d{2}\/\d{2}$/;
export const MONTH_TOTAL_LABEL = "Total";

export const COUNTRIES = [
  "BOL",
  "URU",
  "BRA",
  "ITA",
  "ECU",
  "ESP",
  "INTL",
  "CHI",
  "FIBA",
] as const;
export type Country = (typeof COUNTRIES)[number];

export const COUNTRY_LABEL: Record<Country, string> = {
  BOL: "Bolivia",
  URU: "Uruguay",
  BRA: "Brasil",
  ITA: "Italia",
  ECU: "Ecuador",
  ESP: "España",
  INTL: "Internacional",
  CHI: "Chile",
  FIBA: "FIBA",
};

export const INTL_LEAGUES = [
  "LIBOBASQUET_M",
  "LIBOBASQUET_F",
  "LUB",
  "LDA",
  "NBB",
  "LIGA_OURO",
  "LDB",
  "LEGA_SERIE_A",
  "BASQUETPRO",
  "BASQUETPRO_F",
  "LIGA_ENDESA",
  "PRIMERA_FEB",
  "EUROLIGA",
  "COPA_CHILE",
  "LIGA_UNO",
  "LIGA_DOS",
  "LNF_CHILE",
  "BCLA",
  "LSB_M",
  "LSB_F",
  "WBLA",
  "INTERLIGAS",
] as const;
export type IntlLeague = (typeof INTL_LEAGUES)[number];

export const INTL_LEAGUE_COUNTRY: Record<IntlLeague, Country> = {
  LIBOBASQUET_M: "BOL",
  LIBOBASQUET_F: "BOL",
  LUB: "URU",
  LDA: "URU",
  NBB: "BRA",
  LIGA_OURO: "BRA",
  LDB: "BRA",
  LEGA_SERIE_A: "ITA",
  BASQUETPRO: "ECU",
  BASQUETPRO_F: "ECU",
  LIGA_ENDESA: "ESP",
  PRIMERA_FEB: "ESP",
  EUROLIGA: "INTL",
  COPA_CHILE: "CHI",
  LIGA_UNO: "CHI",
  LIGA_DOS: "CHI",
  LNF_CHILE: "CHI",
  BCLA: "FIBA",
  LSB_M: "FIBA",
  LSB_F: "FIBA",
  WBLA: "FIBA",
  INTERLIGAS: "FIBA",
};

export const INTL_LEAGUE_LABEL: Record<IntlLeague, string> = {
  LIBOBASQUET_M: "Libobasquet Masculina",
  LIBOBASQUET_F: "Libobasquet Femenina",
  LUB: "LUB",
  LDA: "LDA",
  NBB: "NBB",
  LIGA_OURO: "Liga OURO",
  LDB: "LDB",
  LEGA_SERIE_A: "Lega Basket Serie A",
  BASQUETPRO: "BasquetPro",
  BASQUETPRO_F: "BasquetPro Femenina",
  LIGA_ENDESA: "Liga Endesa",
  PRIMERA_FEB: "Primera FEB",
  EUROLIGA: "Euroliga",
  COPA_CHILE: "Copa Chile",
  LIGA_UNO: "Liga Uno (LNB)",
  LIGA_DOS: "Liga Dos",
  LNF_CHILE: "LNF Chile",
  BCLA: "BCLA",
  LSB_M: "LSB Masculino",
  LSB_F: "LSB Femenina",
  WBLA: "WBLA",
  INTERLIGAS: "Interligas",
};
