import type { Page } from '@playwright/test';

// Observe the rendered endpoint, including CSS margins and a short final
// section that cannot physically reach the top of its scrolling container.
export const landingError = (page: Page, selector: string): Promise<number> =>
  page.evaluate((targetSelector) => {
    const scroller = document.querySelector<HTMLElement>('.afterplay-stats-screen')!;
    const target = document.querySelector<HTMLElement>(targetSelector)!;
    const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const padding = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
    const desired = scroller.scrollTop + offset - scroller.clientTop - margin - padding;
    const clamped = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, desired));
    return Math.abs(scroller.scrollTop - clamped);
  }, selector);
