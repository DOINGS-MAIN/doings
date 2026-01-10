import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-button hover:shadow-glow hover:scale-[1.02] active:scale-[0.98]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border-2 border-primary/30 bg-transparent text-foreground hover:border-primary hover:bg-primary/10",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: 
          "hover:bg-muted hover:text-foreground",
        link: 
          "text-primary underline-offset-4 hover:underline",
        // Custom variants for Doings App
        gold: 
          "bg-gradient-to-r from-primary via-yellow-400 to-primary text-primary-foreground font-bold shadow-button hover:shadow-glow hover:scale-[1.02] active:scale-[0.98]",
        glass:
          "glass text-foreground hover:bg-card/80 hover:border-primary/30",
        cyan:
          "bg-secondary text-secondary-foreground font-bold hover:shadow-[0_0_30px_hsl(185_85%_50%/0.4)] hover:scale-[1.02] active:scale-[0.98]",
        accent:
          "bg-accent text-accent-foreground font-bold hover:shadow-[0_0_30px_hsl(15_90%_60%/0.4)] hover:scale-[1.02] active:scale-[0.98]",
        hero:
          "bg-gradient-to-r from-primary via-yellow-400 to-primary text-primary-foreground font-bold text-lg shadow-button hover:shadow-glow hover:scale-[1.03] active:scale-[0.98]",
      },
      size: {
        default: "h-12 px-6 py-3",
        sm: "h-10 rounded-xl px-4 text-xs",
        lg: "h-14 rounded-2xl px-8 text-base",
        xl: "h-16 rounded-3xl px-10 text-lg",
        icon: "h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
