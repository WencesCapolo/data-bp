'use client';
import './globals.css';
import { fontVariables } from './fonts';
import { ErrorScreen } from '@/components/ui/ErrorScreen';

// Replaces the root layout when that layout itself throws, so it brings its own
// <html>, styles and fonts.
export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="es" className={fontVariables}>
      <body>
        <title>Error — Basket.tv Analytics</title>
        <ErrorScreen error={error} retry={unstable_retry} boundary="global" />
      </body>
    </html>
  );
}
