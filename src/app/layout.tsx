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
    <html lang="es" data-theme="dark">
      <head>
        {/* El tema antes del primer pixel. Sin esto, cargar en claro pinta un
            frame oscuro y salta. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('bp-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}",
          }}
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Bebas+Neue&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
