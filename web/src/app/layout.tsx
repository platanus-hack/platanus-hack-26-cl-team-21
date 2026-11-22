import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { MainNav } from "@/components/main-nav";
import { RigoHorizontalMark } from "@/components/brand";
import "./globals.css";

// Self-hosted by next/font at build time: no request to Google at runtime.
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Rigo Lab", template: "%s · Rigo Lab" },
  description: "Portal de investigadores de Rigo: mediciones con su evidencia y su cobertura.",
  icons: { icon: "/isotype.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions add attributes to <html> before React hydrates (e.g. data-mbtss-nonce). This only
    // silences attribute mismatches on <html> itself, one level deep; mismatches in children still show.
    <html lang="es" className={`${playfair.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <SiteHeader>
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
            <Link
              href="/"
              className="flex items-center gap-2.5 text-primary transition-opacity hover:opacity-90"
              aria-label="Rigo Lab"
            >
              <RigoHorizontalMark className="h-7 w-auto text-warning" />
              <span className="font-serif text-xl font-medium tracking-tight text-primary">Lab</span>
            </Link>
            <MainNav />
          </div>
        </SiteHeader>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
