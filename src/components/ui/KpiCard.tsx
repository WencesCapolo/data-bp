interface Props {
  label: string;
  value: number | string;
  sub?: string;
  variant?: 'default' | 'blue' | 'green' | 'yellow' | 'red';
}

export function KpiCard({ label, value, sub, variant = 'default' }: Props) {
  const display = typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div className={`kpi-card ${variant === 'default' ? '' : variant}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{display}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
