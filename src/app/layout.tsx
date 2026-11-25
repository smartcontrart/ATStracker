import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ATS Engine — Multi-Timeframe Polarity Screener & Charting',
  description:
    'Action Trading System (ATS) Multi-Timeframe Screener & 6-Pane Interactive Charting powered by Jack, Oggy, and Didi polarity matrices.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
        {children}
      </body>
    </html>
  );
}
