export function ChartSkeleton({ height = 260, mb = 0 }: { height?: number; mb?: number }) {
  return <div className="skeleton" style={{ height, marginBottom: mb || undefined }} />;
}

export function KpiGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="kpi-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 96 }} />
      ))}
    </div>
  );
}

type Block =
  | { kind: 'full'; height: number }
  | { kind: 'col2'; height: number };

export function TabSkeleton({ kpis = 4, blocks = [] }: { kpis?: number; blocks?: Block[] }) {
  return (
    <div>
      <KpiGridSkeleton count={kpis} />
      {blocks.map((b, i) => {
        const mb = i < blocks.length - 1 ? 24 : 0;
        if (b.kind === 'col2') {
          return (
            <div key={i} className="col2" style={{ marginBottom: mb || undefined }}>
              <ChartSkeleton height={b.height} />
              <ChartSkeleton height={b.height} />
            </div>
          );
        }
        return <ChartSkeleton key={i} height={b.height} mb={mb} />;
      })}
    </div>
  );
}
