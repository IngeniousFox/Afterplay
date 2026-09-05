# Styling

- The desktop renderer and mobile web app already use Tailwind CSS v4 through
  `@tailwindcss/vite`. The desktop entry is `src/renderer/src/assets/main.css`;
  the mobile entry is `web/src/index.css`. Theme tokens are declared with `@theme`.
- Use Tailwind utilities in JSX for layout, spacing, sizing, typography and simple
  states. Reuse existing components and theme tokens before adding custom classes.
  Keep class names literal so Tailwind can detect them.
- Check text at its rendered size, including SVG scaling. Make room for readable
  labels by wrapping or reflowing cards instead of truncating informational summaries.
- Keep `main.css` limited to theme tokens, application-wide base/native controls,
  custom keyframes and necessary third-party overrides. Component gradients,
  shadows, SVG effects, pseudo-elements, interaction states and responsive styles
  belong in JSX using Tailwind utilities, arbitrary values and scoped variants.
  Shared editor typography belongs in `notesProseClass`.
- Do not recreate utilities in component CSS, move those rules to another CSS
  file, or hide the same duplication in long `@apply` blocks. Put child styles on
  their JSX where practical; group long class lists by intent with `cn` and reuse
  actual shared components. Justify any new global CSS exception explicitly.
- Preserve the current design during styling refactors: check all consumers,
  responsive rules, hover/focus states and reduced motion. Existing unlayered CSS
  overrides Tailwind utilities; reconcile conflicting utilities when moving a
  declaration into JSX. Keep pixel and em values when their units matter.
- Styling hooks may also be used by descendant selectors or end-to-end tests.
  Check references before removing or renaming them.
- Build before visual checks: Electron tests launch `out/`, not the source tree.
  Run `npm run build` and the affected Playwright suites using their disposable
  fixtures; never use personal data for automated UI tests.
