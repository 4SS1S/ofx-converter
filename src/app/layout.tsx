import type { Metadata } from "next";
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
  title: "Conversor OFX - Gessele",
  description: "Converta extratos bancários em PDF, DOCX ou TXT para o formato OFX de forma rápida e gratuita.",
  keywords: ["conversor OFX", "extrato bancário", "PDF para OFX", "OFX", "Gessele"],
  authors: [{ name: "Gessele" }],
  robots: "index, follow",
  openGraph: {
    title: "Conversor OFX - Gessele",
    description: "Converta extratos bancários em PDF, DOCX ou TXT para o formato OFX de forma rápida e gratuita.",
    url: "https://ofx-converter-five.vercel.app",
    siteName: "Conversor OFX",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Conversor OFX - Gessele",
    description: "Converta extratos bancários em PDF, DOCX ou TXT para o formato OFX de forma rápida e gratuita.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
