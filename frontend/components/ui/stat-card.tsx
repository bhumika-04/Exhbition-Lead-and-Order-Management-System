'use client';

import type { LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * A single figure — the unit the Dashboard and Orders screens are built from.
 *
 * Design notes worth keeping:
 *  • The value is the largest thing in the card and sits ABOVE the label.
 *    Label-first reads as a form field; value-first reads as a figure.
 *  • Money uses tabular figures so a column of amounts aligns on the decimal.
 *  • The icon is a tinted glyph, not a filled block. Six saturated squares
 *    across a KPI row pull the eye away from the numbers they decorate.
 *  • Interactive cards get a hairline hover and a 1px lift, nothing more —
 *    KPI rows that scale on hover feel cheap.
 */

const toneStyles = cva('', {
  variants: {
    tone: {
      neutral: 'text-muted-foreground bg-secondary',
      primary: 'text-primary bg-primary/10',
      success: 'text-success bg-success/10',
      warning: 'text-warning bg-warning/10',
      danger:  'text-destructive bg-destructive/10',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface StatCardProps extends VariantProps<typeof toneStyles> {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  /** Small qualifier under the value — "3 pending", "since Monday". */
  hint?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  /** Money and counts align better in a column with tabular figures. */
  numeric?: boolean;
}

export function StatCard({
  label, value, icon: Icon, hint, tone, onClick, className, numeric = true,
}: StatCardProps) {
  const Comp = onClick ? 'button' : 'div';

  return (
    <Comp
      onClick={onClick}
      className={cn(
        // block w-full is load-bearing: with an onClick this renders a <button>,
        // which is inline-block by default and therefore shrinks to its content
        // instead of filling its grid cell. That is what made the Dashboard KPI
        // row ragged while the Orders row (no onClick, so a <div>) sat flush.
        'group relative block w-full rounded-lg border border-border bg-card p-3 text-left',
        'transition-[border-color,box-shadow,transform] duration-150',
        onClick && 'hover:border-input hover:shadow-sm hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground leading-none">
          {label}
        </p>
        {Icon && (
          <span className={cn('rounded-md p-1 shrink-0 -mt-0.5', toneStyles({ tone }))}>
            <Icon className="w-3 h-3" />
          </span>
        )}
      </div>

      <p className={cn(
        'mt-1.5 text-xl font-semibold text-foreground leading-none truncate',
        numeric && 'tabular',
      )}>
        {value}
      </p>

      {/* The hint line is always rendered, empty or not. In a grid the cards
          stretch to the tallest, so one card with a hint used to leave a band of
          dead space under every card without one. */}
      <p className="mt-1 h-[13px] text-[10px] text-muted-foreground truncate leading-tight">
        {hint ?? ' '}
      </p>
    </Comp>
  );
}
