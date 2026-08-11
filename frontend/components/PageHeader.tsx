'use client';

import type { LucideIcon } from 'lucide-react';

/**
 * The bar that sits at the top of a screen.
 *
 * `md:min-h-[65px]` is not arbitrary — it matches the sidebar's brand block, so
 * the two bottom borders form one continuous line across the window. Change it
 * here and in Sidebar.tsx together or the seam reappears.
 *
 * Sticky rather than scrolled away: these screens are long, and the title is
 * what tells you which one you are on.
 */
export default function PageHeader({
  icon: Icon,
  title,
  subtitle,
  filters,
  actions,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: React.ReactNode;
  /** Controls that scope the page. Inline from lg, own row below it. */
  filters?: React.ReactNode;
  /** Buttons that act on the page. Always stay on the title's row. */
  actions?: React.ReactNode;
}) {
  return (
    <div className="bg-card/85 backdrop-blur-md border-b border-border sticky top-0 z-20
                    px-4 md:px-6 py-2.5 md:py-0 md:min-h-[65px]
                    flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
      {Icon && (
        // Tinted rather than a filled block: a solid primary square at the top
        // of every screen competes with the actual primary actions below it.
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <h1 className="text-base md:text-[17px] font-semibold text-foreground leading-tight truncate tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">{subtitle}</p>
        )}
      </div>

      {/* Before filters in the DOM so that on a phone it stays on the title's
          row and the filters drop to their own; re-ordered to the far right
          once everything fits on one line. */}
      {actions && <div className="flex items-center gap-2 shrink-0 md:order-last">{actions}</div>}

      {/* Inline from md — the breakpoint the sidebar appears at, so the header
          stays exactly 65px wherever the two borders have to meet. Filters must
          therefore be narrow enough to fit beside a truncating title at 768px. */}
      {/* One row at every width. Stacking them cost a whole band of vertical
          space on a phone for two controls that fit side by side. */}
      {filters && (
        <div className="w-full md:w-auto flex flex-row items-center gap-2">{filters}</div>
      )}
    </div>
  );
}
