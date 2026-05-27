import type { IntlColumnSpec } from "../types";

export const MONTH_COL = 0;
export const WEEK_COL = 1;
export const CONTROL_COL = 2;

export const INTL_COLUMN_SPECS: Record<number, IntlColumnSpec> = {
  3: { country: "BOL", league: "LIBOBASQUET_M", metric: "bpEmitido" },
  4: { country: "BOL", league: "LIBOBASQUET_M", metric: "bpProducido" },
  5: { country: "BOL", league: "LIBOBASQUET_F", metric: "bpEmitido" },
  6: { country: "BOL", league: "LIBOBASQUET_F", metric: "bpProducido" },

  7: { country: "URU", league: "LUB", metric: "total" },
  8: { country: "URU", league: "LUB", metric: "bpEmitido" },
  9: { country: "URU", league: "LUB", metric: "sinTv" },
  10: { country: "URU", league: "LUB", metric: "tvUruguay" },

  11: { country: "URU", league: "LDA", metric: "total" },
  12: { country: "URU", league: "LDA", metric: "bpEmitido" },
  13: { country: "URU", league: "LDA", metric: "sinTv" },
  14: { country: "URU", league: "LDA", metric: "tvUruguay" },

  15: { country: "BRA", league: "NBB", metric: "total" },
  16: { country: "BRA", league: "NBB", metric: "bpEmitido" },
  17: { country: "BRA", league: "NBB", metric: "senalCompleta" },
  18: { country: "BRA", league: "NBB", metric: "offtube" },

  19: { country: "BRA", league: "LIGA_OURO", metric: "total" },
  20: { country: "BRA", league: "LIGA_OURO", metric: "bpEmitido" },
  21: { country: "BRA", league: "LIGA_OURO", metric: "senalCompleta" },
  22: { country: "BRA", league: "LIGA_OURO", metric: "offtube" },

  23: { country: "BRA", league: "LDB", metric: "total" },
  24: { country: "BRA", league: "LDB", metric: "bpEmitido" },
  25: { country: "BRA", league: "LDB", metric: "externoProducido" },

  26: { country: "ITA", league: "LEGA_SERIE_A", metric: "total" },
  27: { country: "ITA", league: "LEGA_SERIE_A", metric: "bpEmitido" },

  28: { country: "ECU", league: "BASQUETPRO", metric: "total" },
  29: { country: "ECU", league: "BASQUETPRO", metric: "bpEmitido" },
  30: { country: "ECU", league: "BASQUETPRO", metric: "bpProducido" },
  31: { country: "ECU", league: "BASQUETPRO", metric: "externoProducido" },

  32: { country: "ECU", league: "BASQUETPRO_F", metric: "total" },
  33: { country: "ECU", league: "BASQUETPRO_F", metric: "bpEmitido" },
  34: { country: "ECU", league: "BASQUETPRO_F", metric: "bpProducido" },
  35: { country: "ECU", league: "BASQUETPRO_F", metric: "externoProducido" },

  36: { country: "ESP", league: "LIGA_ENDESA", metric: "total" },
  37: { country: "ESP", league: "LIGA_ENDESA", metric: "bpEmitido" },
  38: { country: "ESP", league: "LIGA_ENDESA", metric: "offtube" },
  39: { country: "ESP", league: "LIGA_ENDESA", metric: "envioSenalCompleta" },

  40: { country: "ESP", league: "PRIMERA_FEB", metric: "total" },
  41: { country: "ESP", league: "PRIMERA_FEB", metric: "recibidosAtm" },
  42: { country: "ESP", league: "PRIMERA_FEB", metric: "bpEmitido" },
  43: { country: "ESP", league: "PRIMERA_FEB", metric: "enviadosSportian" },

  44: { country: "INTL", league: "EUROLIGA", metric: "total" },
  45: { country: "INTL", league: "EUROLIGA", metric: "bpEmitido" },
  46: { country: "INTL", league: "EUROLIGA", metric: "offtube" },

  47: { country: "CHI", league: "COPA_CHILE", metric: "total" },
  48: { country: "CHI", league: "COPA_CHILE", metric: "bpEmitido" },
  49: { country: "CHI", league: "COPA_CHILE", metric: "emitidosCdo" },

  50: { country: "CHI", league: "LIGA_UNO", metric: "total" },
  51: { country: "CHI", league: "LIGA_UNO", metric: "bpEmitido" },
  52: { country: "CHI", league: "LIGA_UNO", metric: "emitidosCdo" },
  53: { country: "CHI", league: "LIGA_UNO", metric: "enviosSynergy" },

  54: { country: "CHI", league: "LIGA_DOS", metric: "total" },
  55: { country: "CHI", league: "LIGA_DOS", metric: "bpEmitido" },
  56: { country: "CHI", league: "LIGA_DOS", metric: "emitidosCdo" },

  57: { country: "CHI", league: "LNF_CHILE", metric: "total" },
  58: { country: "CHI", league: "LNF_CHILE", metric: "bpEmitido" },
  59: { country: "CHI", league: "LNF_CHILE", metric: "emitidosTvn" },

  60: { country: "FIBA", league: "BCLA", metric: "totalArg" },
  61: { country: "FIBA", league: "BCLA", metric: "totalFuera" },
  62: { country: "FIBA", league: "BCLA", metric: "total" },
  63: { country: "FIBA", league: "BCLA", metric: "bpEmitido" },
  64: { country: "FIBA", league: "BCLA", metric: "bpProducido" },
  65: { country: "FIBA", league: "BCLA", metric: "externoProducido" },

  66: { country: "FIBA", league: "LSB_M", metric: "totalArg" },
  67: { country: "FIBA", league: "LSB_M", metric: "totalFuera" },
  68: { country: "FIBA", league: "LSB_M", metric: "total" },
  69: { country: "FIBA", league: "LSB_M", metric: "bpEmitido" },
  70: { country: "FIBA", league: "LSB_M", metric: "bpProducido" },
  71: { country: "FIBA", league: "LSB_M", metric: "externoProducido" },

  72: { country: "FIBA", league: "LSB_F", metric: "totalArg" },
  73: { country: "FIBA", league: "LSB_F", metric: "totalFuera" },
  74: { country: "FIBA", league: "LSB_F", metric: "total" },
  75: { country: "FIBA", league: "LSB_F", metric: "bpEmitido" },
  76: { country: "FIBA", league: "LSB_F", metric: "bpProducido" },
  77: { country: "FIBA", league: "LSB_F", metric: "externoProducido" },

  78: { country: "FIBA", league: "WBLA", metric: "totalArg" },
  79: { country: "FIBA", league: "WBLA", metric: "totalFuera" },
  80: { country: "FIBA", league: "WBLA", metric: "total" },
  81: { country: "FIBA", league: "WBLA", metric: "bpEmitido" },
  82: { country: "FIBA", league: "WBLA", metric: "bpProducido" },
  83: { country: "FIBA", league: "WBLA", metric: "externoProducido" },

  84: { country: "FIBA", league: "INTERLIGAS", metric: "totalArg" },
  85: { country: "FIBA", league: "INTERLIGAS", metric: "totalFuera" },
  86: { country: "FIBA", league: "INTERLIGAS", metric: "total" },
  87: { country: "FIBA", league: "INTERLIGAS", metric: "bpEmitido" },
  88: { country: "FIBA", league: "INTERLIGAS", metric: "bpProducido" },
  89: { country: "FIBA", league: "INTERLIGAS", metric: "externoProducido" },
};

/** Granular metric -> rollup target. */
export const ROLLUP_MAP: Record<string, "bpProducido" | "externoProducido"> = {
  sinTv: "bpProducido",
  tvUruguay: "externoProducido",
  senalCompleta: "externoProducido",
  offtube: "bpProducido",
  envioSenalCompleta: "bpProducido",
  recibidosAtm: "externoProducido",
  enviadosSportian: "bpProducido",
  emitidosCdo: "externoProducido",
  enviosSynergy: "bpProducido",
  emitidosTvn: "externoProducido",
};
