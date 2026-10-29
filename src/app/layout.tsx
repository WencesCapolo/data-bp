import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { fontVariables } from "./fonts";
import { startSyncScheduler } from "@basket/infrastructure/cron/SyncScheduler";

startSyncScheduler();

// basket-telemetry SDK stub (its README): queues window.bpt calls made before
// /_t/sdk.js loads. Without the nginx /_t/ proxy (local dev) the SDK 404s and
// the queue simply stays unread.
const BPT_STUB =
  "(function(b){b.q=b.q||[];['track','captureError'].forEach(function(m){b[m]=b[m]||function(){b.q.push([m,[].slice.call(arguments)])}})})(window.bpt=window.bpt||{q:[]})";

export const metadata: Metadata = {
  title: "Basket.tv — Analytics",
  description: "Dashboard de suscriptores",
  icons: {
    icon: { url: "/favicon.webp", type: "image/webp" },
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={fontVariables}>
      <body>
        {children}
        <Script id="bpt-stub" strategy="beforeInteractive">{BPT_STUB}</Script>
        <Script src="/_t/sdk.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
