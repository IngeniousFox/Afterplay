import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BRAND_FONT_FAMILY,
  BRAND_VEIL_BACKGROUND,
  BRAND_WORDMARK,
  BRAND_WORDMARK_SHADOW,
  BRAND_WORDMARK_TRACKING,
  BRAND_WORDMARK_WEIGHT,
} from '../../shared/branding';
import { buildSplashHtml } from './splashHtml';

const ICON = 'data:image/png;base64,iVBORw0KGgo=';

describe('startup branding', () => {
  it('keeps the icon separate from the live TV wordmark', () => {
    const html = buildSplashHtml(ICON);
    assert.ok(html.includes(`src="${ICON}" alt=""`));
    assert.ok(html.includes(`<h1 class="title">${BRAND_WORDMARK}</h1>`));
    assert.ok(html.includes('<title>Afterplay</title>'));
    assert.ok(html.includes('role="status" aria-label="Loading Afterplay"'));
  });

  it('shares the TV typography, green veil and glow', () => {
    const html = buildSplashHtml(ICON);
    for (const value of [
      BRAND_FONT_FAMILY,
      BRAND_VEIL_BACKGROUND,
      BRAND_WORDMARK_SHADOW,
      BRAND_WORDMARK_TRACKING,
      `font-weight: ${BRAND_WORDMARK_WEIGHT}`,
    ])
      assert.ok(html.includes(value), value);
  });

  it('is self-contained, never delays startup and supports reduced motion', () => {
    const html = buildSplashHtml(ICON);
    assert.ok(html.includes("default-src 'none'; img-src data:"));
    assert.ok(html.includes('@media (prefers-reduced-motion: reduce)'));
    assert.ok(html.includes('.logo, .title, .line, .dot { animation: none; }'));
    assert.ok(html.includes('1000ms cubic-bezier(.22,1,.36,1) both'));
    assert.doesNotMatch(html, /<script|file:\/\/|https?:\/\/|setTimeout/);
  });

  it('rejects external images and markup injection', () => {
    for (const source of [
      '',
      'file:///icon.png',
      'https://example.com/icon.png',
      'data:image/svg+xml;base64,PHN2Zz4=',
      `${ICON}" onerror="alert(1)`,
    ])
      assert.throws(() => buildSplashHtml(source), /embedded PNG/);
  });
});
