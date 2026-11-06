import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TCT NetGuardia — Network Config & Topology Automator',
  description:
    'TCT NetGuardia: Scheduled multi-vendor config backup, noise-filtered LKG diff engine, LLDP/CDP topology mapper with blast-radius dependency view, and out-of-window drift alerting.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={jetbrainsMono.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-primary selection:text-primary-foreground font-mono">
        {children}
      </body>
    </html>
  );
}
