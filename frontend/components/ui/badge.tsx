import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Status pills.
 *
 * Tinted rather than solid: a row of saturated blocks fights the data for
 * attention, and these sit inline with text. `solid` exists for the one or two
 * places that genuinely need to shout.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
    "transition-colors focus:outline-none focus:ring-2 focus:ring-ring/40",
  {
    variants: {
      variant: {
        default:   "border-border bg-secondary text-muted-foreground",
        primary:   "border-primary/15 bg-primary/10 text-primary",
        success:   "border-success/20 bg-success/10 text-success",
        warning:   "border-warning/20 bg-warning/10 text-warning",
        danger:    "border-destructive/20 bg-destructive/10 text-destructive",
        outline:   "border-border bg-transparent text-muted-foreground",
        solid:     "border-transparent bg-primary text-primary-foreground",

        // Kept for screens outside the redesign pilot that already use the
        // stock shadcn names. `danger` is the preferred spelling going forward;
        // these two can go once every caller has moved.
        secondary:   "border-border bg-secondary text-secondary-foreground",
        destructive: "border-destructive/20 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
