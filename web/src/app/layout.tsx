import type { Metadata } from "next";
import { Newsreader } from "next/font/google";
import Link from "next/link";
import { MainNav } from "@/components/main-nav";
import "./globals.css";

// Self-hosted by next/font at build time: no request to Google at runtime.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: { default: "Rigo Lab", template: "%s · Rigo Lab" },
  description: "Portal de investigadores de Rigo: mediciones con su evidencia y su cobertura.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions add attributes to <html> before React hydrates (e.g. data-mbtss-nonce). This only
    // silences attribute mismatches on <html> itself, one level deep; mismatches in children still show.
    <html lang="es" className={`${newsreader.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-rule">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
            <Link href="/" className="font-serif text-lg font-medium text-primary">
              Rigo Lab
            </Link>
            <MainNav />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
