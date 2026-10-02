import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Oswald, Poppins } from "next/font/google";
import "./globals.css";
import { startSyncScheduler } from "@basket/infrastructure/cron/SyncScheduler";

startSyncScheduler();

// The Portal's fonts, under the variables basket-tv-ui's tokens read.
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["300", "400", "500", "600", "700", "800"], display: "swap" });
const oswald = Oswald({ variable: "--font-oswald", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

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
    <html lang="es" className={`${poppins.variable} ${oswald.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
