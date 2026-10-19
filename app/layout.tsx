import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

// Look & feel "Blueprint" (Option B, chosen by Bronwyn 2026-10-16): one
// sans for everything — headings, body, controls — and a mono for figures,
// references and labels. No serif anywhere except the logo itself.
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Dream Properties OS",
  description: "Dream Knysna operating system",
  applicationName: "Dream OS",
  // Installable on phones (app/manifest.ts). iPhones read these instead of
  // the manifest: home-screen name, icon, and full-screen launch.
  appleWebApp: { capable: true, title: "Dream OS", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#122E87",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
