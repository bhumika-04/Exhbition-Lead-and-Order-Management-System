'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';

export type DatePreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'all';

export const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d',        label: 'Last 7 days' },
  { key: '30d',       label: 'Last 30 days' },
  { key: 'month',     label: 'This month' },
  { key: 'all',       label: 'All time' },
];

export const datePresetLabel = (key: DatePreset) =>
  DATE_PRESETS.find(p => p.key === key)?.label ?? 'All time';

/**
 * Start of the window for a preset, or null when it has no lower bound.
 * Local midnight, not UTC — "today" has to mean the user's today.
 */
export function datePresetStart(key: DatePreset): Date | null {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  switch (key) {
    case 'today':     return start;
    case 'yesterday': return new Date(start.getTime() - 864e5);
    case '7d':        return new Date(start.getTime() - 6 * 864e5);   // inclusive of today
    case '30d':       return new Date(start.getTime() - 29 * 864e5);
    case 'month':     return new Date(start.getFullYear(), start.getMonth(), 1);
    case 'all':       return null;
  }
}

/** Upper bound — only "yesterday" has one, since every other preset runs to now. */
export function datePresetEnd(key: DatePreset): Date | null {
  if (key !== 'yesterday') return null;
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  return end;
}

/**
 * One button that opens the full list, rather than a row of pills.
 * A pill row costs a line of width per option and pushed the other filters onto
 * their own row on anything narrow.
 */
export default function DateFilter({
  value,
  onChange,
  className = '',
}: {
  value: DatePreset;
  onChange: (v: DatePreset) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape — a dropdown left open behind a click is
  // the sort of thing that only shows up on a real device.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full h-9 px-3 rounded-lg border border-border bg-card
                   flex items-center gap-2 text-sm text-foreground hover:border-input transition-colors
                   focus:outline-none focus:ring-2 focus:ring-ring/30"
      >
        <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="flex-1 text-left truncate font-medium">{datePresetLabel(value)}</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-1 w-full min-w-[180px] rounded-lg border border-border
                     bg-popover shadow-lg overflow-hidden py-1"
        >
          {DATE_PRESETS.map(p => (
            <button
              key={p.key}
              role="option"
              aria-selected={p.key === value}
              onClick={() => { onChange(p.key); setOpen(false); }}
              className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                p.key === value
                  ? 'bg-primary/[0.08] text-primary font-semibold'
                  : 'text-muted-foreground hover:bg-secondary/60'
              }`}
            >
              <Check className={`w-3.5 h-3.5 shrink-0 ${p.key === value ? 'opacity-100' : 'opacity-0'}`} />
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
