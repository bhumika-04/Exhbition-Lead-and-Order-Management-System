'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The standard content container: a bordered card with an optional titled head.
 *
 * Sections across the app were each hand-rolling this — same border, slightly
 * different padding and heading size every time. One component means the
 * rhythm holds without anyone having to remember it.
 */
export function Panel({
  title, icon: Icon, action, children, className, bodyClassName, flush = false,
}: {
  title?: React.ReactNode;
  icon?: LucideIcon;
  /** Right-aligned control in the head — "See all", a filter, a button. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Drop body padding, for lists that manage their own row insets. */
  flush?: boolean;
}) {
  return (
    <section className={cn(
      'rounded-lg border border-border bg-card shadow-xs flex flex-col overflow-hidden',
      className,
    )}>
      {title && (
        <header className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/70">
          {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
            {title}
          </h2>
          {action && <div className="ml-auto shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn(!flush && 'p-3.5', 'flex-1 min-w-0', bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/**
 * Nothing-here state. Bounded rather than floating in open space — an
 * unbounded empty state on a tall monitor reads as a broken page.
 */
export function EmptyState({
  icon: Icon, title, hint, action, className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center gap-1.5 rounded-lg',
      'border border-dashed border-border bg-card/40 px-6 py-10 text-center',
      className,
    )}>
      {Icon && (
        <span className="rounded-full bg-secondary p-2.5 mb-1">
          <Icon className="w-5 h-5 text-muted-foreground/60" />
        </span>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
