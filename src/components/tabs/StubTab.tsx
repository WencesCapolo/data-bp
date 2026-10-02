export function StubTab({ name }: { name: string }) {
  return (
    <div className="rounded-[var(--panel-radius)] border border-dashed border-n-300 p-12 text-center font-mono text-sm text-muted">
      <div className="mb-2 font-display text-xl text-n-700">{name}</div>
      <div>Tab pendiente · Phase 6</div>
    </div>
  );
}
