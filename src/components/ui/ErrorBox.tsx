export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="alert-box" style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)' }}>
      <div className="alert-box-title" style={{ color: 'var(--red)' }}>⚠ Error</div>
      <div style={{ fontFamily: 'DM Mono, monospace' }}>{message}</div>
    </div>
  );
}
