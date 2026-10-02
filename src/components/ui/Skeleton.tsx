export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} />;
}

export function KpiGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton h-24" />
      ))}
    </div>
  );
}

type Block =
  | { kind: 'full'; height: number }
  | { kind: 'col2'; height: number };

export function TabSkeleton({ kpis = 4, blocks = [] }: { kpis?: number; blocks?: Block[] }) {
  return (
    <div className="flex flex-col gap-6">
      <KpiGridSkeleton count={kpis} />
      {blocks.map((b, i) =>
        b.kind === 'col2' ? (
          <div key={i} className="grid gap-4 md:grid-cols-2">
            <ChartSkeleton height={b.height} />
            <ChartSkeleton height={b.height} />
          </div>
        ) : (
          <ChartSkeleton key={i} height={b.height} />
        ),
      )}
    </div>
  );
}
