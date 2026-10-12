import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", {
  variants: {
    variant: {
      default: "bg-muted text-foreground",
      primary: "bg-primary/10 text-primary",
      red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
      amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
      green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
      outline: "border border-border",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  return <Badge variant={priority === "A" ? "red" : priority === "B" ? "amber" : "default"}>Prio {priority}</Badge>;
}
