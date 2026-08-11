'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Compact multi-select with a free-text escape hatch.
 *
 * Options come from the catalogue, but a counter will always meet a size or
 * colour nobody has stocked yet, so anything can be typed and added rather
 * than blocking the order on a Product Master edit.
 *
 * The menu renders through a PORTAL, positioned fixed against the trigger's
 * bounding box. An absolutely positioned menu is clipped by any ancestor that
 * scrolls or hides overflow, and this control lives inside the order row, which
 * does both. Portalling is the only fix that does not require every ancestor to
 * cooperate.
 */
export default function MultiSelect({
  label,
  values,
  options,
  onChange,
  placeholder = 'Select',
  disabled = false,
  disabledHint,
}: {
  label: string;
  values: string[];
  options: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_MAX = 280;   // matches the max-height below

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    // Flip above only when there is genuinely more room there, so the menu does
    // not jump upward on a screen where neither side fits well.
    const above = below < Math.min(MENU_MAX, 240) && r.top > below;

    const width = Math.max(r.width, 176);
    // Clamp into the viewport so a right-hand control cannot push the menu
    // off-screen on a phone.
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);

    setPos({ top: above ? r.top - 4 : r.bottom + 4, left, width, above });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The menu is outside this component's DOM subtree now, so both have to
      // be checked or clicking inside the menu would close it.
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // `true` captures scrolls on inner containers, not just the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const toggle = (v: string) =>
    onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v]);

  const addCustom = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };

  // Anything already chosen but absent from the catalogue still needs a row.
  const allOptions = Array.from(new Set([...options, ...values]));

  if (disabled) {
    return (
      <div className="flex-1 min-w-0">
        <span className="text-[10px] text-muted-foreground block mb-0.5">{label}</span>
        <div className="h-9 flex items-center text-[11px] text-muted-foreground px-1">
          {disabledHint ?? 'n/a'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0">
      <span className="text-[10px] text-muted-foreground block mb-0.5">{label}</span>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full h-9 px-2 rounded-lg border border-border bg-card text-sm
                   flex items-center gap-1 text-left transition-colors
                   hover:border-input focus:outline-none focus:ring-2 focus:ring-ring/30"
      >
        <span className={cn('flex-1 truncate', values.length ? 'text-foreground' : 'text-muted-foreground')}>
          {values.length ? values.join(', ') : placeholder}
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform',
                                   open && 'rotate-180')} />
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: pos.above ? undefined : pos.top,
            bottom: pos.above ? window.innerHeight - pos.top : undefined,
            left: pos.left,
            width: pos.width,
          }}
          className="z-[100] rounded-lg border border-border bg-popover shadow-lg overflow-hidden"
        >
          <div className="max-h-[200px] overflow-y-auto py-1">
            {allOptions.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">
                Nothing in the catalogue yet. Type below to add one.
              </p>
            )}
            {allOptions.map(opt => {
              const on = values.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(opt)}
                  className={cn('w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                                on ? 'bg-primary/[0.06]' : 'hover:bg-secondary/70')}
                >
                  <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0',
                                      on ? 'bg-primary border-primary' : 'border-input')}>
                    {on && <Check className="w-3 h-3 text-primary-foreground" />}
                  </span>
                  <span className="truncate text-foreground">{opt}</span>
                </button>
              );
            })}
          </div>

          <div className="flex gap-1 p-2 border-t border-border">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
              placeholder="Add another"
              className="flex-1 h-8 px-2 rounded-md border border-border bg-card text-xs
                         focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <button type="button" onClick={addCustom} aria-label="Add"
                    className="h-8 w-8 rounded-md bg-secondary hover:bg-secondary/70
                               flex items-center justify-center shrink-0">
              <Plus className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* Chips only when several are picked. One value already reads fine in
          the trigger, and duplicating it wastes a line on a dense row. */}
      {values.length > 1 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {values.map(v => (
            <span key={v}
                  className="inline-flex items-center gap-0.5 bg-secondary text-muted-foreground
                             rounded px-1.5 py-0.5 text-[10px]">
              {v}
              <button type="button" onClick={() => toggle(v)} aria-label={`Remove ${v}`}
                      className="hover:text-destructive">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
