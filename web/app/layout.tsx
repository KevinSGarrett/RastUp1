// web/app/layout.tsx
import './globals.css';
import type { ReactNode } from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'RastUp',
  description: 'RastUp app'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="app-shell">
        <a className="app-shell__skip-link" href="#main-content">
          Skip to main content
        </a>
        <header className="app-shell__header" role="banner">
          <div className="app-shell__brand">
            <Link href="/">RastUp</Link>
          </div>
          <nav className="app-shell__nav" aria-label="Primary navigation">
            <ul>
              <li>
                <Link href="/search">Search</Link>
              </li>
              <li>
                <Link href="/u/avery-harper/model">Profile</Link>
              </li>
              <li>
                <Link href="/booking/srv_mdl_avery">Booking</Link>
              </li>
              <li>
                <Link href="/app/messaging">Messaging</Link>
              </li>
              <li>
                <Link href="/app/calendar">Calendar</Link>
              </li>
            </ul>
          </nav>
        </header>
        <main id="main-content" className="app-shell__main">
          {children}
        </main>
        <footer className="app-shell__footer" role="contentinfo">
          <p>© {new Date().getFullYear()} RastUp. All rights reserved.</p>
        </footer>
      </body>
    </html>
  );
}
