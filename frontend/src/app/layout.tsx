import type { Metadata, Viewport } from 'next';
import './globals.css';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/AppShell';
import { Toaster } from '@/components/ui/sonner';

const interFont = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'";

export const metadata: Metadata = {
  title: 'Rupasingha Capital | Branch Intelligence',
  description: 'Core pawning and branch transaction platform',
  icons: {
    icon: '/rupasinghe_logo.png',
    shortcut: '/rupasinghe_logo.png',
    apple: '/rupasinghe_logo.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body style={{ fontFamily: interFont }} className="bg-background text-foreground dashboard-shell antialiased" suppressHydrationWarning>
        <AuthGuard>
          <AppShell>
            {children}
          </AppShell>
        </AuthGuard>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
