import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Command Prompt',
  icons: {
    icon: '/cmd-icon.svg'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="w-screen h-screen overflow-hidden bg-[#0C0C0C]">{children}</body>
    </html>
  );
}