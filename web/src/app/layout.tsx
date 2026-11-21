import type { Metadata } from "next";
import { Newsreader } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// Self-hosted by next/font at build time: no request to Google at runtime.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Observatorio Longitudinal Multimodal",
  description: "Portal de investigadores",
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
              Observatorio Longitudinal Multimodal
            </Link>
            <nav aria-label="Principal" className="text-sm">
              <Link href="/studies" className="inline-flex min-h-10 items-center text-ink-muted hover:text-ink">
                Estudios
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
