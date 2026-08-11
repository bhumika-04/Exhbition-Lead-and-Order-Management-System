'use client';

import { useEffect, useState } from 'react';

const EDITABLE = /^(INPUT|TEXTAREA|SELECT)$/;

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (EDITABLE.test(el.tagName) || el.isContentEditable);

/**
 * True while the on-screen keyboard is (almost certainly) covering the bottom
 * of the screen.
 *
 * Two signals, because neither is reliable alone:
 *
 *  • focusin/focusout — works everywhere and states the intent directly, but a
 *    <select> opens a picker rather than a keyboard, and focus can persist
 *    while the keyboard is dismissed by the back gesture.
 *  • visualViewport — the only honest measurement on iOS, where window
 *    .innerHeight does NOT change when the keyboard appears. Absent on older
 *    Android WebViews, which is why it cannot be the only source.
 *
 * Either one firing is treated as "keyboard up". A false positive costs a
 * hidden nav bar for a moment; a false negative costs a covered input.
 */
export function useKeyboardOpen() {
  const [focused, setFocused] = useState(false);
  const [shrunk, setShrunk] = useState(false);

  useEffect(() => {
    const onIn  = (e: FocusEvent) => { if (isEditable(e.target)) setFocused(true); };
    const onOut = () => setFocused(false);

    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);

    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    // 150px is comfortably more than a browser toolbar collapsing and
    // comfortably less than any real keyboard.
    const onResize = () => {
      if (vv) setShrunk(window.innerHeight - vv.height > 150);
    };
    vv?.addEventListener('resize', onResize);
    onResize();

    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      vv?.removeEventListener('resize', onResize);
    };
  }, []);

  return focused || shrunk;
}
