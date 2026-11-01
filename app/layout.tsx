import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Betmark | Сравнение букмекеров",
  description: "Сравнение коэффициентов букмекерских контор",
  // manifest.ts (app/manifest.ts) и app/icon.png, app/apple-icon.png
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Betmark",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#18191c" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Найдено (при отладке sticky-заголовка таблицы): было <html className="h-full">
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="/fonts.css" />
        {/* Приоритетная загрузка шрифта значков - без preload браузер узнаёт про этот файл только разобрав fonts.css */}
        <link
          rel="preload"
          href="/fonts/material-symbols-subset-v1.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Next.js metadata.appleWebApp сам генерирует mobile-web-app-capable */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="color-scheme" content="light" />
        <script dangerouslySetInnerHTML={{ __html: 'try{var t=localStorage.getItem("bm-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}' }} />
        <link rel="apple-touch-icon" media="(prefers-color-scheme: dark)" href="/icons/icon-dark-180.png" />
      </head>
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
