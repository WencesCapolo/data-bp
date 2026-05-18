export function StubTab({ name }: { name: string }) {
  return (
    <div className="tab-stub">
      <div style={{ fontSize: 20, fontFamily: 'Bebas Neue, sans-serif', marginBottom: 8 }}>{name}</div>
      <div>Tab pendiente · Phase 6</div>
    </div>
  );
}
