import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Crowdpulse', template: '%s, Crowdpulse' },
  description: 'Contact-free vitals at check-in and a live waiting-room worklist for triage nurses',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
