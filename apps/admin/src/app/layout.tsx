import type { Metadata } from 'next';

import { Shell } from '@/components/Shell';

import './globals.css';

export const metadata: Metadata = {
  title: 'Waves admin',
  robots: { index: false, follow: false },
};

/**
 * There is no `viewport` export and no breakpoints below 1024px, on purpose.
 * This is a desktop tool: `body { min-width: 1024px }` means a narrow screen
 * gets the real layout and has to pan, which is at least honest, rather than a
 * reflowed one that pretends to work. The login page opts back out of that
 * floor (`body:has(.login-page)` in `globals.css`), because signing in from a
 * phone to check the console is up is a real thing to do.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
