import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Engineering OS',
  description: 'Unified operations platform for panel manufacturing - projects, people, plant.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
