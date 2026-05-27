import type { ColumnSpec } from "../types";

export const MONTH_COL = 0;
export const WEEK_COL = 1;
export const CONTROL_COL = 2;

export const COLUMN_SPECS: Record<number, ColumnSpec> = {
  3: { league: "LNB", org: "ADC", metric: "total" },
  4: { league: "LNB", org: "ADC", metric: "tyc" },
  5: { league: "LNB", org: "ADC", metric: "directTv" },
  6: { league: "LNB", org: "ADC", metric: "bpEmitido" },
  7: { league: "LNB", org: "ADC", metric: "bpProducido" },
  8: { league: "LNB", org: "ADC", metric: "externoProducido" },

  9: { league: "LA", org: "ADC", metric: "total" },
  10: { league: "LA", org: "ADC", metric: "bpEmitido" },
  11: { league: "LA", org: "ADC", metric: "bpProducido" },
  12: { league: "LA", org: "ADC", metric: "externoProducido" },

  13: { league: "LDD", org: "ADC", metric: "total" },
  14: { league: "LDD", org: "ADC", metric: "bpEmitido" },
  15: { league: "LDD", org: "ADC", metric: "bpProducido" },
  16: { league: "LDD", org: "ADC", metric: "externoProducido" },

  17: { league: "LFEM", org: "ADC", metric: "total" },
  18: { league: "LFEM", org: "ADC", metric: "bpEmitido" },
  19: { league: "LFEM", org: "ADC", metric: "bpProducido" },
  20: { league: "LFEM", org: "ADC", metric: "externoProducido" },

  21: { league: "LFED_M", org: "CAB", metric: "total" },
  22: { league: "LFED_M", org: "CAB", metric: "bpEmitido" },
  23: { league: "LFED_M", org: "CAB", metric: "bpProducido" },
  24: { league: "LFED_M", org: "CAB", metric: "externoProducido" },

  25: { league: "LIGA_METRO", org: "CAB", metric: "total" },
  26: { league: "LIGA_METRO", org: "CAB", metric: "bpEmitido" },
  27: { league: "LIGA_METRO", org: "CAB", metric: "bpProducido" },
  28: { league: "LIGA_METRO", org: "CAB", metric: "externoProducido" },
};
