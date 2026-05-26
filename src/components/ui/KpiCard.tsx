interface Props {
  label: string;
  value: number | string;
  sub?: string;
  delta?: { value: string; up: boolean };
  variant?: 'default' | 'blue' | 'green' | 'yellow' | 'red';
}

export function KpiCard({ label, value, sub, delta, variant = 'default' }: Props) {
  const display = typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div className={`kpi-card ${variant === 'default' ? '' : variant}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{display}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {delta && (
        <div className={`kpi-delta ${delta.up ? 'up' : 'down'}`}>
          {delta.up ? '▲' : '▼'} {delta.value}
        </div>
      )}
    </div>
  );
}
