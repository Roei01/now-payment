import type { Metadata } from "next";

import { AppProviders } from "../providers/app-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Now Payment",
  description: "Restaurant crypto payment terminal with invoicing automation.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
