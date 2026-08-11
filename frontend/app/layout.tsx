import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import ClientProviders from '@/components/ClientProviders';
import AppShell from '@/components/AppShell';
import '../styles/globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Tejoo Fashion - Exhibition Management System',
  description: 'Tejoo Fashion Exhibition Management System, powered by Indus Analytics Private Limited',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // maximumScale is deliberately NOT set. It was 1, which is the usual way to
  // stop iOS Safari zooming when a small-font input is focused — but it also
  // blocks pinch-zoom entirely, which fails WCAG 1.4.4 and is miserable for
  // anyone reading a barcode or a Sales Order on a phone. The zoom is fixed at
  // the root instead: form controls are 16px on small screens (globals.css).
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <AppShell>
          {children}
        </AppShell>
        <ClientProviders />
      </body>
    </html>
  );
}
