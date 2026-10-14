/**
 * compose.ts - HyperFrames HTML compositions for the motion title and end
 * cards. Pure: strings in, string out. Author text is always HTML-escaped and
 * every value that lands in CSS is validated first (defense in depth; the
 * config schema already constrains colors and font names).
 */

import { hookLayout } from "../cards.js";

export interface CardHtmlOpts {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  font: string;
  backdropTop: string;
  backdropBottom: string;
  accent: string;
  title: string;
  subtitle?: string;
  hook?: string;
  url?: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// eslint-disable-next-line no-control-regex
const FONT_BAD = /[\x00-\x1f"'\\;{}<>]/;

function color(c: string): string {
  if (!HEX.test(c)) throw new Error(`invalid color for motion card: ${JSON.stringify(c)}`);
  return escapeHtml(c);
}

function fontName(f: string): string {
  if (!f || FONT_BAD.test(f)) throw new Error(`invalid font name for motion card: ${JSON.stringify(f)}`);
  return f;
}

function checkNumbers(o: CardHtmlOpts): void {
  const evenInt = (n: unknown): boolean => typeof n === "number" && Number.isInteger(n) && n > 0 && n % 2 === 0;
  if (!evenInt(o.width)) throw new Error(`invalid width for motion card (positive even integer): ${JSON.stringify(o.width)}`);
  if (!evenInt(o.height)) throw new Error(`invalid height for motion card (positive even integer): ${JSON.stringify(o.height)}`);
  if (typeof o.fps !== "number" || !Number.isInteger(o.fps) || o.fps <= 0) throw new Error(`invalid fps for motion card (positive integer): ${JSON.stringify(o.fps)}`);
  if (typeof o.durationSec !== "number" || !Number.isFinite(o.durationSec) || o.durationSec <= 0 || o.durationSec > 60) {
    throw new Error(`invalid durationSec for motion card (finite, >0, <=60): ${String(o.durationSec)}`);
  }
}

type Anim = readonly [delay: number, duration: number];
const fmt = (n: number): string => String(Number(n.toFixed(3)));

/** Scales every animation so all finish by the time the closing fade starts. */
function timing(durationSec: number, anims: Anim[]): { t: (a: Anim) => string; fadeStart: number } {
  const fadeStart = Math.max(0, durationSec - 0.4);
  const natural = Math.max(...anims.map(([d, u]) => d + u));
  const k = natural > fadeStart ? fadeStart / natural : 1;
  return { t: ([d, u]) => `${fmt(u * k)}s ease-out ${fmt(d * k)}s`, fadeStart };
}

const KEYFRAMES = `
@keyframes settle { from { transform: scale(1.04); } to { transform: scale(1); } }
@keyframes reveal { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
@keyframes draw { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes fadeout { from { opacity: 1; } to { opacity: 0; } }
`;

function page(o: CardHtmlOpts, bodyHtml: string, css: string, fadeStart: number): string {
  const top = color(o.backdropTop);
  const bottom = color(o.backdropBottom);
  const font = fontName(o.font);
  const dur = String(o.durationSec);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@font-face { font-family: "${font}"; src: local("${font}"); font-weight: 100 900; }
html, body { width: ${o.width}px; height: ${o.height}px; margin: 0; overflow: hidden; }
#root { position: relative; width: ${o.width}px; height: ${o.height}px; overflow: hidden; background: linear-gradient(180deg, ${top}, ${bottom}); font-family: "${font}", sans-serif; color: #ffffff; }
.clip { position: absolute; left: 0; top: 0; width: ${o.width}px; height: ${o.height}px; }
#content { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; animation: fadeout 0.4s linear ${fmt(fadeStart)}s 1 forwards; }
${KEYFRAMES}${css}
</style>
</head>
<body>
<div id="root" data-no-timeline data-composition-id="main" data-start="0" data-duration="${dur}" data-fps="${o.fps}" data-width="${o.width}" data-height="${o.height}">
<div class="clip" data-start="0" data-duration="${dur}" data-track-index="1">
<div id="content">
${bodyHtml}
</div>
</div>
</div>
</body>
</html>
`;
}

export function titleCardHtml(o: CardHtmlOpts): string {
  checkNumbers(o);
  const hookText = o.hook?.trim() ?? "";
  const accent = color(o.accent);
  const h = o.height;
  const barW = Math.round(o.width * 0.09);
  const barH = Math.max(4, Math.round(h * 0.007));
  const hasHook = hookText.length > 0;
  const A_HOOK: Anim = [0, 0.5], A_BAR: Anim = [0.3, 0.4], A_TITLE: Anim = hasHook ? [0.5, 0.5] : [0, 0.5], A_SUB: Anim = [0.7, 0.5];
  const { t, fadeStart } = timing(o.durationSec, [...(hasHook ? [A_HOOK] : []), A_BAR, A_TITLE, ...(o.subtitle ? [A_SUB] : [])]);
  let css = "";
  let body = "";
  if (hasHook) {
    const layout = hookLayout(o.width, o.height, hookText);
    const lineH = Math.round(layout.fontSize * 1.2);
    css += `#hook { font-size: ${layout.fontSize}px; line-height: ${lineH}px; font-weight: bold; color: #ffffff; animation: settle ${t(A_HOOK)} 1 both; }
#hook .line { display: block; white-space: nowrap; }
`;
    body += `<div id="hook">${layout.lines.map((l) => `<div class="line">${escapeHtml(l)}</div>`).join("")}</div>\n`;
  }
  const titleSize = Math.round(h * (hasHook ? 0.034 : 0.085));
  const subSize = Math.round(hasHook ? titleSize * 0.8 : h * 0.034);
  css += `#bar { width: ${barW}px; height: ${barH}px; background: ${accent}; margin-top: ${Math.round(h * 0.02)}px; transform-origin: center; animation: draw ${t(A_BAR)} 1 both; }
`;
  if (hasHook) {
    css += `#title { font-size: ${titleSize}px; margin-top: ${Math.round(h * 0.015)}px; opacity: 0; animation: reveal ${t(A_TITLE)} 1 forwards; }
`;
  } else {
    css += `#title { font-size: ${titleSize}px; font-weight: bold; animation: settle ${t(A_TITLE)} 1 both; }
`;
  }
  css += `#subtitle { font-size: ${subSize}px; color: #b6c2cc; margin-top: ${Math.round(h * 0.015)}px; opacity: 0; animation: reveal ${t(A_SUB)} 1 forwards; }
`;
  const titleHtml = `<div id="title">${escapeHtml(o.title)}</div>\n`;
  const barHtml = `<div id="bar"></div>\n`;
  body += hasHook ? barHtml + titleHtml : titleHtml + barHtml;
  if (o.subtitle) body += `<div id="subtitle">${escapeHtml(o.subtitle)}</div>\n`;
  return page(o, body, css, fadeStart);
}

export function endCardHtml(o: CardHtmlOpts): string {
  checkNumbers(o);
  const E_TITLE: Anim = [0.1, 0.5], E_URL: Anim = [0.4, 0.5];
  const { t, fadeStart } = timing(o.durationSec, [E_TITLE, ...(o.url ? [E_URL] : [])]);
  const accent = color(o.accent);
  const h = o.height;
  const css = `#title { font-size: ${Math.round(h * 0.05)}px; font-weight: bold; opacity: 0; animation: reveal ${t(E_TITLE)} 1 forwards; }
#url { font-size: ${Math.round(h * 0.042)}px; color: ${accent}; margin-top: ${Math.round(h * 0.03)}px; opacity: 0; animation: reveal ${t(E_URL)} 1 forwards; }
`;
  let body = `<div id="title">${escapeHtml(o.title)}</div>\n`;
  if (o.url) body += `<div id="url">${escapeHtml(o.url)}</div>\n`;
  return page(o, body, css, fadeStart);
}
