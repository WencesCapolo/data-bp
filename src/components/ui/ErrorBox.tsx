export function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-[var(--panel-radius)] border border-[var(--accent-border)] bg-accent-soft px-4 py-3.5">
      <div className="font-display text-sm font-semibold tracking-[0.08em] text-accent-strong uppercase">⚠ Error</div>
      <div className="mt-1 font-mono text-xs leading-relaxed text-n-800">{message}</div>
    </div>
  );
}
