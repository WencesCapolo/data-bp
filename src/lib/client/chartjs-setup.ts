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
  Chart.defaults.color = '#8899bb';
  Chart.defaults.font.family = "'Poppins', system-ui, sans-serif";
  Chart.defaults.font.size = 11;
  registered = true;
}
