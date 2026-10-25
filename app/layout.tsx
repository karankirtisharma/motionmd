import type { Metadata, Viewport } from 'next';
import { DM_Sans, Geist_Mono, Instrument_Sans, Instrument_Serif } from 'next/font/google';
import './globals.css';

// Self-hosted at build (same variable font as the former Google Fonts @import, which blocked first paint).
const dmSans = DM_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-dm-sans' });
// The Screen OS faces, drawn into the lounge screen's canvas. Not preloaded: the canvas
// requests them only when a visitor sits down.
const screenSerif = Instrument_Serif({ weight: '400', subsets: ['latin'], preload: false, variable: '--font-screen-serif' });
const screenSans = Instrument_Sans({ subsets: ['latin'], preload: false, variable: '--font-screen-sans' });
const screenMono = Geist_Mono({ subsets: ['latin'], preload: false, variable: '--font-screen-mono' });

export const metadata: Metadata = {
  title: 'md. — A space for ideas',
  description: 'An interactive architectural visit to the Motion Design lounge. Explore the original space in live 3D.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#10100f' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${dmSans.variable} ${screenSerif.variable} ${screenSans.variable} ${screenMono.variable}`}><body>{children}</body></html>;
}
