import type { Metadata, Viewport } from "next";
import "./globals.css";
import { startSyncScheduler } from "@basket/infrastructure/cron/SyncScheduler";

startSyncScheduler();

export const metadata: Metadata = {
  title: "Basket.tv — Analytics",
  description: "Dashboard de suscriptores",
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
    <html lang="es">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Bebas+Neue&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
