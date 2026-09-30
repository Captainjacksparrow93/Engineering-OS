import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

/**
 * CursorGothic is a licensed face; the design system names Inter at weight 400 with
 * negative tracking as the substitute. Both families are committed in the repo
 * (src/app/fonts/) and loaded via next/font/local, so building and running requires
 * no outbound internet access.
 */
const sans = localFont({
  src: [
    {
      path: './fonts/inter/Inter-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/inter/Inter-Medium.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: './fonts/inter/Inter-SemiBold.woff2',
      weight: '600',
      style: 'normal',
    },
  ],
  variable: '--font-sans',
  display: 'swap',
});

const mono = localFont({
  src: [
    {
      path: './fonts/jetbrains-mono/JetBrainsMono-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/jetbrains-mono/JetBrainsMono-Medium.woff2',
      weight: '500',
      style: 'normal',
    },
  ],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    template: '%s · Engineering OS',
    default: 'Engineering OS',
  },
  description: 'Unified operations platform for panel manufacturing - projects, people, plant.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
