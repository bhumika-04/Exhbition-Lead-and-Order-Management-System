'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Numeric entry that opens the right keypad on a phone.
 *
 * Deliberately NOT <input type="number">:
 *  • iOS shows a keyboard with "e", "+" and "-" on it, none of which belong in
 *    a quantity or a price.
 *  • A number input reports an EMPTY value for anything the browser considers
 *    invalid, so a stray character silently wipes the field and the operator
 *    sees a blank where their figure was.
 *  • Scroll-wheel over a focused number input changes it, which has ruined more
 *    than one form.
 *
 * `type="text"` with inputMode and pattern gives the numeric keypad on both iOS
 * and Android while keeping the value under our control. Characters that do not
 * belong are filtered as they are typed.
 */
export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: string;
  onValueChange: (v: string) => void;
  /** integer = whole pieces; decimal = money. */
  mode?: 'integer' | 'decimal';
  maxLength?: number;
}

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onValueChange, mode = 'integer', className, maxLength, ...props }, ref) => {
    const clean = (raw: string) => {
      if (mode === 'integer') return raw.replace(/\D/g, '');
      // One decimal point, digits either side. Everything else goes.
      const stripped = raw.replace(/[^0-9.]/g, '');
      const [head, ...rest] = stripped.split('.');
      return rest.length ? `${head}.${rest.join('').slice(0, 2)}` : head;
    };

    return (
      <input
        ref={ref}
        type="text"
        inputMode={mode === 'integer' ? 'numeric' : 'decimal'}
        // Historically the trigger for iOS's pure number pad, and still the
        // clearest signal to assistive tech about what belongs here.
        pattern={mode === 'integer' ? '[0-9]*' : '[0-9]*[.]?[0-9]*'}
        autoComplete="off"
        maxLength={maxLength}
        value={value}
        onChange={e => onValueChange(clean(e.target.value))}
        onFocus={e => e.target.select()}
        // Stops a scroll over the field silently editing it.
        onWheel={e => e.currentTarget.blur()}
        className={cn(
          'h-10 w-full px-3 rounded-lg border border-border bg-card text-sm tabular',
          'focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-input',
          className,
        )}
        {...props}
      />
    );
  },
);
NumberInput.displayName = 'NumberInput';
