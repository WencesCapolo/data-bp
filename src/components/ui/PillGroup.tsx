'use client';

/** A row of filter chips where exactly one is on. */
export function PillGroup<T>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { val: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Names the group for screen readers. */
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          className="pill"
          aria-pressed={value === o.val}
          onClick={() => onChange(o.val)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
