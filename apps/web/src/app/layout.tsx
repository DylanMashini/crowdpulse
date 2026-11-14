import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Triage Cam', template: '%s, Triage Cam' },
  description: 'Contact-free vitals station and waiting-room worklist. Research prototype, not validated for clinical use.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
