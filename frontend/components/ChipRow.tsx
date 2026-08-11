'use client';

import { Lock } from 'lucide-react';

/**
 * Multi-select as a row of chips.
 *
 * Preferred over a dropdown wherever the option list is short — which is every
 * size and colour list here, since they come from one barcode. Every option is
 * visible without opening anything, choosing two is two taps rather than
 * open-tap-tap-close, and what is selected stays readable while the quantity
 * matrix below is being filled in.
 *
 * Shared by the counter's order form and the customer's own ordering page so
 * the two screens behave identically — staff talk customers through this.
 */
export default function ChipRow({
  label, options, values, onChange, emptyHint, locked = false, lockedHint, className = '',
}: {
  label: string;
  options: string[];
  values: string[];
  onChange: (v: string[]) => void;
  /** Shown instead of chips when the product carries no options for this axis. */
  emptyHint?: string;
  /**
   * The values are not a choice, so none of them can be turned off.
   *
   * True for a catalogue SET — "(red,green,blue)" ships as three pieces, not as
   * three options — and for an axis with a single value, where deselecting it
   * would leave the line with nothing. Rendered as selected and inert rather
   * than hidden, because the operator still needs to see what is included.
   */
  locked?: boolean;
  lockedHint?: string;
  className?: string;
}) {
  const toggle = (o: string) => {
    if (locked) return;
    onChange(values.includes(o) ? values.filter(v => v !== o) : [...values, o]);
  };

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-1.5 gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        {locked ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary shrink-0">
            <Lock className="w-2.5 h-2.5" /> sold as a set
          </span>
        ) : values.length > 1 ? (
          <span className="text-[10px] text-muted-foreground shrink-0">{values.length} selected</span>
        ) : null}
      </div>

      {options.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70 italic">
          {emptyHint ?? 'Nothing to choose'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {options.map(o => {
              const active = values.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  aria-pressed={active}
                  disabled={locked}
                  // Locked chips keep the selected styling and lose only the
                  // hover and the pointer. Greying them out would read as
                  // "unavailable" when they are the opposite — compulsory.
                  className={`h-9 px-3 rounded-lg border text-sm transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground font-medium'
                      : 'border-border bg-card text-foreground hover:border-input'
                  } ${locked ? 'cursor-default' : ''}`}
                >
                  {o}
                </button>
              );
            })}
          </div>
          {locked && lockedHint && (
            <p className="text-[10px] text-muted-foreground mt-1.5">{lockedHint}</p>
          )}
        </>
      )}
    </div>
  );
}
