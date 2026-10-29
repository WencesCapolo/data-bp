import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // basket-telemetry resolves browser stacks with these maps, read from disk
  // (.next/static). nginx denies *.map to the public (basket-telemetry wizard-f0).
  productionBrowserSourceMaps: true,
};

export default nextConfig;
