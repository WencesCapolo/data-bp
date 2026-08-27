'use client';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * El tema vive en un solo sitio: `data-theme` sobre `<html>`.
 *
 * Ni contexto ni provider. El atributo lo escribe un script inline en el
 * layout antes de pintar (para que no haya un flash oscuro al cargar en
 * claro), y este módulo lo lee y lo cambia. Un evento propio avisa a los
 * componentes que no pueden leer una variable CSS — los gráficos, que pintan
 * en canvas y necesitan el color como string.
 */
export type Theme = 'dark' | 'light';

export const THEME_KEY = 'bp-theme';
export const THEME_EVENT = 'bp-theme-change';

export function readTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function writeTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Modo privado o almacenamiento bloqueado: el tema vale para esta pestaña
    // y no se recuerda. Preferible a romper el toggle.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

/**
 * El tema actual, re-renderizando cuando cambia.
 *
 * El atributo del `<html>` es la fuente de verdad y vive fuera de React, así
 * que se lee como un store externo. Con `useState` + efecto habría un render
 * en cascada en cada montaje; acá el servidor entrega el tema por defecto y la
 * hidratación lee el que el script inline ya dejó puesto.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  const toggle = useCallback(() => writeTheme(readTheme() === 'light' ? 'dark' : 'light'), []);
  return { theme, toggle };
}

function serverTheme(): Theme {
  return 'dark';
}

/**
 * Colores de rejilla y de ejes para Chart.js, que no puede leer una variable
 * CSS: el canvas necesita el valor resuelto en el momento de construir la
 * configuración.
 */
export interface ChartTheme {
  theme: Theme;
  grid: string;
  tick: string;
  /** Fondo de la tarjeta: los anillos del doughnut se separan con él. */
  surface: string;
  border: string;
}

// Objetos constantes y no construidos en cada render: los gráficos los usan
// como dependencia de un `useMemo`, y una identidad nueva por render
// destruiría y recrearía cada canvas.
const CHART_THEMES: Record<Theme, ChartTheme> = {
  dark: { theme: 'dark', grid: '#1e2a42', tick: '#8899bb', surface: '#0f1525', border: '#2a3752' },
  light: { theme: 'light', grid: '#e2e8f0', tick: '#64748b', surface: '#ffffff', border: '#cbd5e1' },
};

export function useChartTheme(): ChartTheme {
  return CHART_THEMES[useTheme().theme];
}
