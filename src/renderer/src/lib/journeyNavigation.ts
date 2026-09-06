const MAX_NAVIGATION_MS = 5_000;
const TOLERANCE_PX = 2;
const TAKEOVER_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;

const scrollParent = (target: HTMLElement): HTMLElement => {
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return document.scrollingElement as HTMLElement;
};

// Save a document anchor, not scrollTop: laying out skipped months above the
// viewport changes scrollTop's meaning. This also covers a cold upward jump.
const viewportAnchor = (scroller: HTMLElement, months: HTMLElement[]): (() => void) => {
  const top = scroller.getBoundingClientRect().top + scroller.clientTop;
  const anchor =
    months.find((month) => month.getBoundingClientRect().bottom > top) ?? months.at(-1);
  if (!anchor) return () => {};
  const previousTop = anchor.getBoundingClientRect().top;
  return () => {
    const shift = anchor.getBoundingClientRect().top - previousTop;
    if (Math.abs(shift) > 0.1) {
      scroller.scrollTo({ top: scroller.scrollTop + shift, behavior: 'instant' });
    }
  };
};

// One layout pass on an explicit navigation, then one native animation. Keep
// normal scrolling/entry lazy; never restart smooth scrolling to chase moving
// intrinsic-size estimates. The returned cancellation also stops native motion.
export const navigateJourney = (
  target: HTMLElement,
  monthElements: Iterable<HTMLElement>,
  onFinish: (cancelled: boolean, trigger?: Event) => void,
): (() => void) => {
  const scroller = scrollParent(target);
  const months = [...monthElements].filter((month) => month.isConnected);
  const previousStyles = months.map((month) => ({
    visibility: month.style.contentVisibility,
    containment: month.style.contain,
  }));
  const previousAnchoring = scroller.style.overflowAnchor;
  const restoreViewport = viewportAnchor(scroller, months);
  let frame = 0;
  let timeout = 0;
  let finished = false;

  scroller.style.overflowAnchor = 'none';
  for (const month of months) {
    month.style.contentVisibility = 'visible';
    // Keep the non-size containment that content-visibility:auto normally
    // supplies, so preflight layout uses the same formatting/clipping rules.
    month.style.contain = 'layout style paint';
  }
  // A clicked month may still be in its delayed entrance animation. Finish
  // that finite effect once instead of measuring a translated landing target.
  for (const animation of target.getAnimations()) {
    if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
  }
  restoreViewport();

  const cacheMonthHeights = (): void => {
    // Read all heights before writing: no read/write layout loop. These month
    // wrappers have no padding/border; their boxes are intrinsic content sizes.
    const heights = months.map((month) => month.getBoundingClientRect().height);
    months.forEach((month, index) => {
      month.style.setProperty('--journey-measured-height', `${heights[index]}px`);
    });
  };
  cacheMonthHeights();

  const aligned = (): boolean => {
    const scrollerTop = scroller.getBoundingClientRect().top + scroller.clientTop;
    const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
    const desired =
      scroller.scrollTop + target.getBoundingClientRect().top - scrollerTop - margin - padding;
    const clamped = Math.max(0, Math.min(desired, scroller.scrollHeight - scroller.clientHeight));
    return Math.abs(scroller.scrollTop - clamped) <= TOLERANCE_PX;
  };

  const finish = (cancelled: boolean, trigger?: Event): void => {
    if (finished) return;
    finished = true;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timeout);
    scroller.removeEventListener('scrollend', onScrollEnd);
    for (const event of TAKEOVER_EVENTS) window.removeEventListener(event, cancel);
    window.removeEventListener('resize', cancel);
    // Explicit instant also overrides the parent screen's scroll-smooth CSS.
    scroller.scrollTo({ top: scroller.scrollTop, behavior: 'instant' });
    const preservePosition = viewportAnchor(scroller, months);
    cacheMonthHeights();
    months.forEach((month, index) => {
      month.style.contentVisibility = previousStyles[index].visibility;
      month.style.contain = previousStyles[index].containment;
    });
    preservePosition();
    if (!cancelled && target.isConnected) {
      target.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
    scroller.style.overflowAnchor = previousAnchoring;
    onFinish(cancelled, trigger);
  };
  const cancel = (trigger?: Event): void => finish(true, trigger);
  const onScrollEnd = (): void => {
    // Preflight anchor adjustment can queue its own scrollend. It must not
    // stop the journey just started after it; only the actual landing counts.
    if (target.isConnected && aligned()) finish(false);
  };
  for (const event of TAKEOVER_EVENTS) window.addEventListener(event, cancel, { passive: true });
  window.addEventListener('resize', cancel, { passive: true });
  // Start the bound before rAF: a hidden window may pause preparation too.
  timeout = window.setTimeout(() => finish(false), MAX_NAVIGATION_MS);

  // Let Chromium remember the laid-out intrinsic sizes before restoring auto.
  // The measured fallback also protects a cancellation before those frames run.
  frame = window.requestAnimationFrame(() => {
    frame = window.requestAnimationFrame(() => {
      if (finished || !target.isConnected) {
        cancel();
        return;
      }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || aligned()) {
        finish(false);
        return;
      }
      scroller.addEventListener('scrollend', onScrollEnd);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  return cancel;
};
