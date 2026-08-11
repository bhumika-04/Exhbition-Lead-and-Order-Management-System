'use client';

import { useEffect, useState } from 'react';
import { hasPermission } from './auth';

/**
 * Permission check that is safe to use during render.
 *
 * `hasPermission` reads localStorage, which does not exist during SSR — so it
 * returns false on the server and true on the client for the same user. Calling
 * it directly in a component body therefore renders two different trees and
 * React throws "Expected server HTML to contain a matching <div>", discarding
 * the whole server render and falling back to client rendering.
 *
 * This returns false until after mount, so the first client render matches the
 * server exactly, then the real answer applies on the next paint. Gated UI
 * appears a frame late, which is invisible next to the data fetch that follows
 * it — and correct, which the direct call was not.
 */
export function usePermission(key: string): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => { setAllowed(hasPermission(key)); }, [key]);

  return allowed;
}
