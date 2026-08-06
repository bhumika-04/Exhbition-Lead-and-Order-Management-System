import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import ClientProviders from '@/components/ClientProviders';
import AppShell from '@/components/AppShell';
import '../styles/globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'ELCS - Exhibition Lead Capture',
  description: 'INDAS Analytics Exhibition Lead Capture System',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
