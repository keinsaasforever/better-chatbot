import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import { AgentNotificationPrefsSync } from "@/components/agent-alerts/agent-notification-prefs-sync";
import { DesktopUpdateNotifier } from "@/components/desktop/desktop-update-toast";
import {
  BootDetector,
  BootShellDetector,
} from "@/components/layouts/boot-detector";
import {
  ThemeProvider,
  ThemeStyleProvider,
} from "@/components/layouts/theme-provider";
import { THEME_STYLE_BOOTSTRAP_SCRIPT } from "@/lib/theme/theme-style-bootstrap";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { headers } from "next/headers";
import { Toaster } from "ui/sonner";
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "keinsaas navigator",
  description:
    "Keinsaas Navigator is an AI assistant that uses tools to answer questions and help with tasks.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // `resizes-content` makes Chrome/Android shrink the layout viewport when the
  // keyboard opens, so the `dvh` chat shell reflows and the composer stays
  // visible instead of being panned out of view. iOS Safari ignores it.
  //
  // Deliberately NOT `viewportFit: "cover"`: that extends the layout viewport
  // under the notch, and with no top safe-area padding in the shell it made
  // chat content paint over the iOS status bar.
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const requestHeaders = await headers();
  const bootVisitId = requestHeaders.get("x-boot-visit-id");
  const bootDocumentId = requestHeaders.get("x-boot-document-id");
  const bootDiagnosticsEnabled =
    process.env.BOOT_DIAGNOSTICS === "1" &&
    requestHeaders.get("sec-fetch-dest") === "document" &&
    Boolean(bootVisitId) &&
    Boolean(bootDocumentId);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {/*
          Must stay the first child of <body>: it sets `data-theme` from
          localStorage before the rest of the document paints, which is what
          lets ThemeStyleProvider server-render its children instead of
          blanking the whole app until hydration.
        */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, build-time constant with no interpolated input */}
        <script
          dangerouslySetInnerHTML={{ __html: THEME_STYLE_BOOTSTRAP_SCRIPT }}
        />
        {bootDiagnosticsEnabled && bootVisitId && bootDocumentId && (
          <BootDetector visitId={bootVisitId} documentId={bootDocumentId} />
        )}
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          themes={["light", "dark"]}
          storageKey="app-theme-v2"
          disableTransitionOnChange
        >
          <ThemeStyleProvider>
            <NextIntlClientProvider>
              <div id="root">
                {bootDiagnosticsEnabled && <BootShellDetector />}
                <AgentNotificationPrefsSync />
                <DesktopUpdateNotifier />
                {children}
                <Toaster richColors />
              </div>
            </NextIntlClientProvider>
          </ThemeStyleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
