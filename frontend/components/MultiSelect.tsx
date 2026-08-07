'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, Plus, X } from 'lucide-react';

/**
 * Compact multi-select with a free-text escape hatch.
 *
 * Options come from the catalogue, but a counter will always meet a size or
 * colour nobody has stocked yet — so anything can be typed and added rather
 * than blocking the order on a Product Master edit.
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
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
        <span className="text-[10px] text-slate-400 block mb-0.5">{label}</span>
        <div className="h-9 flex items-center text-[11px] text-slate-400 px-1">
          {disabledHint ?? 'n/a'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 relative" ref={boxRef}>
      <span className="text-[10px] text-slate-400 block mb-0.5">{label}</span>

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full h-9 px-2 rounded-lg border border-slate-200 bg-white text-sm flex items-center gap-1 text-left"
      >
        <span className={`flex-1 truncate ${values.length ? 'text-slate-800' : 'text-slate-400'}`}>
          {values.length ? values.join(', ') : placeholder}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[10rem] rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="max-h-44 overflow-y-auto py-1">
            {allOptions.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-slate-400">Nothing in the catalogue yet — type below</p>
            )}
            {allOptions.map(opt => {
              const on = values.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(opt)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 text-left"
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    on ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
                  }`}>
                    {on && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="truncate text-slate-700">{opt}</span>
                </button>
              );
            })}
          </div>

          <div className="flex gap-1 p-2 border-t border-slate-100">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
              placeholder="Add another…"
              className="flex-1 h-8 px-2 rounded-lg border border-slate-200 text-xs"
            />
            <button type="button" onClick={addCustom}
                    className="h-8 w-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center shrink-0">
              <Plus className="w-3.5 h-3.5 text-slate-600" />
            </button>
          </div>
        </div>
      )}

      {/* Chips only when several are picked — one value already reads fine in
          the trigger, and duplicating it wastes a line on a dense row. */}
      {values.length > 1 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {values.map(v => (
            <span key={v} className="inline-flex items-center gap-0.5 bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[10px]">
              {v}
              <button type="button" onClick={() => toggle(v)} aria-label={`Remove ${v}`}
                      className="hover:text-rose-500">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
