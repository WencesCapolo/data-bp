export const CHANNELS = ["tyc", "directTv", "bpEmitido"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  tyc: "TyC",
  directTv: "DirectTV",
  bpEmitido: "BP",
};

export const CHANNEL_COLOR: Record<Channel, string> = {
  tyc: "#0ea5e9",
  directTv: "#f59e0b",
  bpEmitido: "#c62c2c",
};
