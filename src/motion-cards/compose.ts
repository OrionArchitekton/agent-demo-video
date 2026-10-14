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

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const FONT_BAD = /["'\\;{}<>\r\n]/;

function color(c: string): string {
  if (!HEX.test(c)) throw new Error(`invalid color for motion card: ${JSON.stringify(c)}`);
  return escapeHtml(c);
}

function fontName(f: string): string {
  if (!f || FONT_BAD.test(f)) throw new Error(`invalid font name for motion card: ${JSON.stringify(f)}`);
  return escapeHtml(f);
}

const KEYFRAMES = `
@keyframes settle { from { transform: scale(1.04); } to { transform: scale(1); } }
@keyframes reveal { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
@keyframes draw { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes fadeout { from { opacity: 1; } to { opacity: 0; } }
`;

function page(o: CardHtmlOpts, bodyHtml: string, css: string): string {
  const top = color(o.backdropTop);
  const bottom = color(o.backdropBottom);
  const font = fontName(o.font);
  const dur = String(o.durationSec);
  const fadeStart = Math.max(0, o.durationSec - 0.4);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body { width: ${o.width}px; height: ${o.height}px; margin: 0; overflow: hidden; }
#root { position: relative; width: ${o.width}px; height: ${o.height}px; overflow: hidden; background: linear-gradient(180deg, ${top}, ${bottom}); font-family: "${font}", sans-serif; color: #ffffff; }
.clip { position: absolute; left: 0; top: 0; width: ${o.width}px; height: ${o.height}px; }
#content { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; animation: fadeout 0.4s linear ${fadeStart}s 1 forwards; }
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
  const accent = color(o.accent);
  const h = o.height;
  const barW = Math.round(o.width * 0.09);
  const barH = Math.max(4, Math.round(h * 0.007));
  const hasHook = !!o.hook;
  let css = "";
  let body = "";
  if (hasHook) {
    const layout = hookLayout(o.width, o.height, o.hook!);
    const lineH = Math.round(layout.fontSize * 1.2);
    css += `#hook { font-size: ${layout.fontSize}px; line-height: ${lineH}px; font-weight: bold; color: #ffffff; animation: settle 0.5s ease-out 0s 1 both; }
#hook .line { display: block; white-space: nowrap; }
`;
    body += `<div id="hook">${layout.lines.map((l) => `<div class="line">${escapeHtml(l)}</div>`).join("")}</div>\n`;
  }
  const titleSize = Math.round(h * (hasHook ? 0.034 : 0.085));
  const subSize = Math.round(hasHook ? titleSize * 0.8 : h * 0.034);
  css += `#bar { width: ${barW}px; height: ${barH}px; background: ${accent}; margin-top: ${Math.round(h * 0.02)}px; transform-origin: center; animation: draw 0.4s ease-out 0.3s 1 both; }
`;
  if (hasHook) {
    css += `#title { font-size: ${titleSize}px; margin-top: ${Math.round(h * 0.015)}px; opacity: 0; animation: reveal 0.5s ease-out 0.5s 1 forwards; }
`;
  } else {
    css += `#title { font-size: ${titleSize}px; font-weight: bold; animation: settle 0.5s ease-out 0s 1 both; }
`;
  }
  css += `#subtitle { font-size: ${subSize}px; color: #b6c2cc; margin-top: ${Math.round(h * 0.015)}px; opacity: 0; animation: reveal 0.5s ease-out 0.7s 1 forwards; }
`;
  const titleHtml = `<div id="title">${escapeHtml(o.title)}</div>\n`;
  const barHtml = `<div id="bar"></div>\n`;
  body += hasHook ? barHtml + titleHtml : titleHtml + barHtml;
  if (o.subtitle) body += `<div id="subtitle">${escapeHtml(o.subtitle)}</div>\n`;
  return page(o, body, css);
}

export function endCardHtml(o: CardHtmlOpts): string {
  const accent = color(o.accent);
  const h = o.height;
  const css = `#title { font-size: ${Math.round(h * 0.05)}px; font-weight: bold; opacity: 0; animation: reveal 0.5s ease-out 0.1s 1 forwards; }
#url { font-size: ${Math.round(h * 0.042)}px; color: ${accent}; margin-top: ${Math.round(h * 0.03)}px; opacity: 0; animation: reveal 0.5s ease-out 0.4s 1 forwards; }
`;
  let body = `<div id="title">${escapeHtml(o.title)}</div>\n`;
  if (o.url) body += `<div id="url">${escapeHtml(o.url)}</div>\n`;
  return page(o, body, css);
}
