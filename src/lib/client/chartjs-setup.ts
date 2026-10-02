'use client';
import {
  Chart,
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LineController,
  LineElement,
  BarController,
  DoughnutController,
  PieController,
  PointElement,
  LinearScale,
  TimeScale,
  Tooltip,
} from 'chart.js';
import { CHART_THEME } from './palette';

let registered = false;
export function ensureChartJs(): void {
  if (registered) return;
  Chart.register(
    LineController,
    BarController,
    DoughnutController,
    PieController,
    LineElement,
    BarElement,
    ArcElement,
    PointElement,
    CategoryScale,
    LinearScale,
    TimeScale,
    Filler,
    Legend,
    Tooltip,
  );
  Chart.defaults.color = CHART_THEME.tick;
  Chart.defaults.borderColor = CHART_THEME.grid;
  // next/font serves Poppins under a hashed family name; the variable holds it.
  Chart.defaults.font.family =
    getComputedStyle(document.documentElement).getPropertyValue('--font-poppins').trim() || "'Poppins', system-ui, sans-serif";
  Chart.defaults.font.size = 11;
  registered = true;
}
