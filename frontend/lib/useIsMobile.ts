'use client';

import { useEffect, useState } from 'react';

/**
 * True on phones and tablets, where a file input with `capture` hands off to the
 * native camera app. Desktop returns false and callers open the in-page webcam
 * dialog instead, since `capture` there only ever yields a file picker.
 *
 * Resolved after mount rather than during render — `navigator` does not exist
 * during SSR, and reading it inline would produce a hydration mismatch.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const ua = navigator.userAgent;
    setIsMobile(
      /android|iphone|ipad|ipod/i.test(ua) ||
      // iPadOS reports itself as a Mac; touch points give it away.
      (navigator.maxTouchPoints > 1 && /macintosh/i.test(ua))
    );
  }, []);

  return isMobile;
}
