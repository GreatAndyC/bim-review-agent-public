import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "BIM Review Agent — Evidence-first IFC review",
    template: "%s · BIM Review Agent",
  },
  description:
    "A Site-contained, evidence-first IFC review Agent with deterministic verdicts and auditable results.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    title: "BIM Review Agent",
    description:
      "Upload an IFC. Inspect deterministic PASS, FAIL, and REVIEW findings with model and rule evidence.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "BIM Review Agent evidence-first IFC review workspace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BIM Review Agent",
    description: "Evidence-first IFC review with deterministic verdicts.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#0f1f3d",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
