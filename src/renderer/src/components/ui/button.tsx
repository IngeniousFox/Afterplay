import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// Fósforo (docs/redesign/concepts/b-fosforo/README-sistema.md, hojas 1 y 4):
// radio 4, foco con outline Phosphor de 2 px, pulsar = scale(.97), disabled al
// 40 % y solo transiciones de propiedades concretas.
const buttonVariants = cva(
  [
    'group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm border border-transparent bg-clip-padding text-body font-medium whitespace-nowrap select-none',
    'transition-[background-color,border-color,color,transform] duration-[160ms] ease-out active:scale-[.97] active:duration-[120ms] motion-reduce:active:scale-100',
    'outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor',
    'disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-live',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: 'bg-phosphor text-ink hover:bg-phosphor-hi active:bg-phosphor-lo',
        secondary:
          'border-line-strong bg-raised text-bone hover:border-line-hover hover:bg-raised-hover active:bg-raised-active aria-expanded:bg-raised-hover',
        // Alias de secondary: Fósforo no tiene variante outline propia.
        outline:
          'border-line-strong bg-raised text-bone hover:border-line-hover hover:bg-raised-hover active:bg-raised-active aria-expanded:bg-raised-hover',
        ghost:
          'text-dust hover:bg-bone/6 hover:text-bone active:bg-bone/11 aria-expanded:bg-bone/6 aria-expanded:text-bone',
        destructive: 'bg-live text-ink-live hover:bg-live-hi active:bg-live-lo',
        link: 'text-tube underline-offset-4 hover:text-tube-hi hover:underline active:scale-100',
      },
      size: {
        default:
          'h-8.5 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5',
        xs: "h-6 gap-1 px-2 text-micro has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-small has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-11 gap-2 px-4 text-lead has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        icon: 'size-8.5',
        'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
