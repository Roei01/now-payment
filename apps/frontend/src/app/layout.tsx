import type { Metadata } from "next";
import Script from "next/script";

import { AppProviders } from "../providers/app-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "תשלומי קריפטו למסעדות",
  description: "מערכת תשלומי קריפטו למסעדות עם QR, מעקב חי והפקת חשבונית אוטומטית.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
        >{`(() => {
  const storageKey = "now-payment-theme";
  const storedTheme = window.localStorage.getItem(storageKey);
  const theme = storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
    ? storedTheme
    : "system";
  const resolvedTheme = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
})();`}</Script>
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
