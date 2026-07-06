import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Translucent "tint" look used for the live-session button/badge/row family
 * (SPEC 10.2): a soft background + colored border + colored text, never a
 * solid fill. Combine with Button's `default`/`secondary`/`destructive`
 * variants only — `ghost`/`outline` set their own `hover:text-foreground`,
 * which would override the tone color on hover.
 *
 * `secondary` renders off `--muted-foreground` (solid #888f8a), not
 * `--secondary` — `--secondary` is itself translucent (rgba white, SPEC
 * 10.1's card2), so stacking a Tailwind opacity modifier on top multiplies
 * the alpha down to near-invisible (0.045 * 0.14 ≈ 0.006).
 *
 * Also sets the `dark:` variants explicitly: `destructive` ships its own
 * `dark:bg-destructive/20` baked in, which wins over a plain `bg-destructive/14`
 * once .dark is active (different tailwind-merge slot, not deduped) — so every
 * value here is repeated under `dark:` to stay deterministic regardless of
 * which base variant it's layered on.
 */
export const tintVariants = cva('border', {
  variants: {
    tone: {
      primary: 'text-primary',
      destructive: 'text-destructive',
      secondary: 'text-muted-foreground',
    },
    intensity: {
      strong: '',
      soft: '',
    },
  },
  compoundVariants: [
    {
      tone: 'primary',
      intensity: 'strong',
      class:
        'bg-primary/14 border-primary/50 hover:bg-primary/22 dark:bg-primary/14 dark:hover:bg-primary/22',
    },
    {
      tone: 'destructive',
      intensity: 'strong',
      class:
        'bg-destructive/14 border-destructive/50 hover:bg-destructive/22 dark:bg-destructive/14 dark:hover:bg-destructive/22',
    },
    {
      tone: 'secondary',
      intensity: 'strong',
      class:
        'bg-muted-foreground/14 border-muted-foreground/50 hover:bg-muted-foreground/22 dark:bg-muted-foreground/14 dark:hover:bg-muted-foreground/22',
    },
    {
      tone: 'primary',
      intensity: 'soft',
      class:
        'bg-primary/6 border-primary/40 hover:bg-primary/10 dark:bg-primary/6 dark:hover:bg-primary/10',
    },
    {
      tone: 'destructive',
      intensity: 'soft',
      class:
        'bg-destructive/6 border-destructive/40 hover:bg-destructive/10 dark:bg-destructive/6 dark:hover:bg-destructive/10',
    },
    {
      tone: 'secondary',
      intensity: 'soft',
      class:
        'bg-muted-foreground/6 border-muted-foreground/40 hover:bg-muted-foreground/10 dark:bg-muted-foreground/6 dark:hover:bg-muted-foreground/10',
    },
  ],
  defaultVariants: {
    tone: 'primary',
    intensity: 'strong',
  },
});

export type TintProps = VariantProps<typeof tintVariants>;
