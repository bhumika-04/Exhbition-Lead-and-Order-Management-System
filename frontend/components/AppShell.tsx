'use client';

import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';

// Pages that manage their own internal scrolling (fixed-height layout)
const FIXED_HEIGHT_PATHS = ['/chat', '/leads', '/exhibitions'];

// Same, but with a dynamic segment. These screens pin a header at the top and
// scroll their body, which only works inside a bounded container — an exact
// path match would silently leave them scrolling the whole page instead.
const FIXED_HEIGHT_PATTERNS = [
  /^\/orders\/[^/]+$/,               // order detail
  /^\/leads\/[^/]+\/orders\/new$/,   // place order
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Auth pages get no shell (full-screen login).
  // /o/* is the public self-service ordering page — it renders for visitors on
  // their own phones, so it must never show staff navigation.
  if (pathname.startsWith('/auth') || pathname.startsWith('/o/')) {
    return <>{children}</>;
  }

  // Gate isFixedHeight on mounted to avoid SSR/client mismatch.
  // Both server and client render the scrollable <main> on first pass;
  // after mount the fixed-height variant switches in (one silent re-render).
  const isFixedHeight = mounted && (
    FIXED_HEIGHT_PATHS.includes(pathname) ||
    FIXED_HEIGHT_PATTERNS.some(re => re.test(pathname))
  );

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />

      {isFixedHeight ? (
        // Fixed-height pages: flex column so pages can use flex-1 for internal scrolling
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {children}
        </main>
      ) : (
        // Scrollable pages: main itself scrolls, pages are plain block content
        <main className="flex-1 overflow-y-auto">
          {children}
          {/* Mobile bottom nav clearance */}
          <div className="md:hidden h-16" />
        </main>
      )}

      <BottomNav />
    </div>
  );
}
