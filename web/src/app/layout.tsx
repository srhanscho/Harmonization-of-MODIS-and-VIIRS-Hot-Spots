import type { Metadata, Viewport } from "next";
import { Public_Sans } from "next/font/google";
import "./globals.css";

// One institutional sans for every role (public-sector legibility, tabular figures for data).
const publicSans = Public_Sans({ variable: "--font-sans", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "K-Fire — Harmonized MODIS + VIIRS burning calendar",
  description:
    "Did the fire change, or the satellite? A harmonized month-by-year calendar of fire activity from MODIS and VIIRS hot spots.",
  icons: {
    icon: "/logok-fire.png",
    shortcut: "/logok-fire.png",
    apple: "/logok-fire.png",
  },
};

export const viewport: Viewport = { themeColor: "#eef2f6", colorScheme: "light" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
