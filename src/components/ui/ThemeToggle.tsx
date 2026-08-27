'use client';
import { useTheme } from '@/lib/client/theme';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === 'light' ? 'oscuro' : 'claro';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={`Cambiar a tema ${next}`}
      aria-label={`Cambiar a tema ${next}`}
    >
      {theme === 'light' ? '🌙' : '☀️'} {theme === 'light' ? 'Oscuro' : 'Claro'}
    </button>
  );
}
