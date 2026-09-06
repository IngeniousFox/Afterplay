import {
  BRAND_FONT_FAMILY,
  BRAND_NAME,
  BRAND_VEIL_BACKGROUND,
  BRAND_WORDMARK,
  BRAND_WORDMARK_SHADOW,
  BRAND_WORDMARK_TRACKING,
  BRAND_WORDMARK_WEIGHT,
} from '../../shared/branding';

export const SPLASH_SIZE = { width: 380, height: 340 } as const;

// A pure builder also lets the visual tests inspect the real startup page
// without keeping a production startup waiting just to take a screenshot.
export const buildSplashHtml = (iconDataUrl: string): string => {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(iconDataUrl)) {
    throw new Error('The splash icon must be an embedded PNG');
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'" />
<title>${BRAND_NAME}</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body {
    -webkit-app-region: drag;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: ${BRAND_VEIL_BACKGROUND};
    font-family: ${BRAND_FONT_FAMILY};
    color: #eaece9;
    -webkit-user-select: none;
    user-select: none;
  }
  .logo {
    display: block; width: 128px; height: 128px; object-fit: contain;
    margin-bottom: 17px;
    animation: afterplay-splash-icon 700ms cubic-bezier(.22,1,.36,1) both;
  }
  .title {
    margin: 0; font-size: 22px; line-height: 1.35;
    font-weight: ${BRAND_WORDMARK_WEIGHT};
    letter-spacing: ${BRAND_WORDMARK_TRACKING};
    padding-left: ${BRAND_WORDMARK_TRACKING};
    text-shadow: ${BRAND_WORDMARK_SHADOW};
    animation: afterplay-splash-mark 1000ms cubic-bezier(.22,1,.36,1) both;
  }
  .line {
    width: 180px; height: 2px; margin-top: 13px; border-radius: 2px;
    background: linear-gradient(90deg, transparent, #2fdc7e, transparent);
    box-shadow: 0 0 12px rgba(47,220,126,.5);
    animation: afterplay-splash-line 900ms cubic-bezier(.22,1,.36,1) both;
  }
  .dots { display: flex; gap: 6px; margin-top: 25px; }
  .dot {
    width: 5px; height: 5px; border-radius: 50%; background: #2fdc7e;
    animation: afterplay-splash-pulse 1.2s ease-in-out infinite;
  }
  .dot:nth-child(2) { animation-delay: .15s; }
  .dot:nth-child(3) { animation-delay: .3s; }
  @keyframes afterplay-splash-icon {
    from { opacity: 0; transform: translateY(5px) scale(.94); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  /* The TV reveal settles here instead of fading away: a slow database
     must never leave a blank splash. No timer delays the actual startup. */
  @keyframes afterplay-splash-mark {
    from { opacity: 0; letter-spacing: .34em; filter: blur(6px); }
    to { opacity: 1; letter-spacing: ${BRAND_WORDMARK_TRACKING}; filter: blur(0); }
  }
  @keyframes afterplay-splash-line {
    0%, 28% { transform: scaleX(0); opacity: 0; }
    100% { transform: scaleX(1); opacity: 1; }
  }
  @keyframes afterplay-splash-pulse {
    0%, 80%, 100% { opacity: .25; transform: scale(.85); }
    40% { opacity: 1; transform: scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .logo, .title, .line, .dot { animation: none; }
    .dot { opacity: .65; }
  }
</style>
</head>
<body>
  <img class="logo" src="${iconDataUrl}" alt="" width="128" height="128" />
  <h1 class="title">${BRAND_WORDMARK}</h1>
  <div class="line" aria-hidden="true"></div>
  <div class="dots" role="status" aria-label="Loading Afterplay">
    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
  </div>
</body>
</html>`;
};
