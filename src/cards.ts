/**
 * cards.ts — branded title and end cards (production-polish S5)
 *
 * Rendered as ordinary silent segments on the backdrop gradient: a ~2s cold
 * open with the product name, and a ~3s end card with the URL. Pure module:
 * ffmpeg argument builders only.
 */

import { filterPathEscape, x264Args, X264 } from "./ffmpeg.js";

const BASE = ["-y", "-hide_banner", "-loglevel", "error"];

export interface CardOpts {
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
  fadeSec?: number;
}

/**
 * Operator text is NEVER inlined into the filtergraph: drawtext quoting rules
 * make in-band escaping fragile (a quote cannot be backslash-escaped inside a
 * quoted value), so all text is referenced via textfile= paths the pipeline
 * writes. This also closes the text-injection class outright.
 */
export interface CardTextFiles { titleFile: string; subtitleFile?: string; urlFile?: string; hookFiles?: string[] }

/**
 * The textfile PATH itself lives inside the filtergraph string, so it uses
 * the same shared escaping as subtitle paths (option-level specials plus the
 * graph-level separators; see ffmpeg.ts filterPathEscape).
 */
const tf = filterPathEscape;

const hex = (c: string): string => "0x" + c.replace(/^#/, "");

function gradientInput(o: CardOpts): string[] {
  const grad = `gradients=s=${o.width}x${o.height}:c0=${hex(o.backdropTop)}:c1=${hex(o.backdropBottom)}:x0=${Math.round(o.width / 2)}:y0=0:x1=${Math.round(o.width / 2)}:y1=${o.height}:d=${Math.ceil(o.durationSec + 1)}`;
  return ["-f", "lavfi", "-i", grad];
}

function cardArgs(o: CardOpts, lines: string[], out: string, fadeIn = true): string[] {
  const fade = o.fadeSec ?? 0.4;
  const vf = [
    ...lines,
    ...(fadeIn ? [`fade=t=in:st=0:d=${fade}`] : []),
    `fade=t=out:st=${Math.max(0, o.durationSec - fade)}:d=${fade}`,
    `fps=${o.fps}`,
    "format=yuv420p",
  ].join(",");
  return [
    ...BASE,
    ...gradientInput(o),
    "-t", String(o.durationSec),
    "-vf", vf,
    ...x264Args(X264.crfComposite), "-an",
    out,
  ];
}

/** Greedy word wrap; a single word longer than maxChars gets its own line. */
export function wrapHook(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.trim().split(/\s+/)) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Estimated rendered width: uppercase letters and digits 0.68 em, everything else 0.55 em. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += /[A-Z0-9]/.test(ch) ? 0.68 : 0.55;
  return em * fontSize;
}

function wrapByWidth(text: string, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.trim().split(/\s+/)) {
    if (!cur) cur = w;
    else if (estimateTextWidth(cur + " " + w, fontSize) <= maxWidth) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Hook font size and lines. Starts large (7.5% of height on portrait, 8.5% on
 * landscape) and shrinks 5% at a time (floor 3.5% of height) until every
 * wrapped line is estimated to fit 90% of the width. At the floor the result
 * is accepted: a single giant word may still overflow (documented limit).
 */
export function hookLayout(width: number, height: number, hook: string): { fontSize: number; lines: string[] } {
  const maxWidth = width * 0.9;
  const floor = Math.round(height * 0.035);
  let fontSize = Math.round(height * (height > width ? 0.075 : 0.085));
  for (;;) {
    const lines = wrapByWidth(hook, fontSize, maxWidth);
    const widest = Math.max(...lines.map((l) => estimateTextWidth(l, fontSize)));
    if (widest <= maxWidth || fontSize <= floor) return { fontSize, lines };
    fontSize = Math.max(floor, Math.round(fontSize * 0.95));
  }
}

/** Cold-open title card: product name, optional subtitle, accent underline. */
export function titleCardArgs(o: CardOpts, out: string, files: CardTextFiles): string[] {
  if (o.hook && files.hookFiles?.length) return hookTitleCardArgs(o, out, files, files.hookFiles);
  const titleSize = Math.round(o.height * 0.085);
  const subSize = Math.round(o.height * 0.034);
  const barW = Math.round(o.width * 0.09);
  const barH = Math.max(4, Math.round(o.height * 0.007));
  const lines = [
    `drawtext=expansion=none:font=${o.font}:textfile=${tf(files.titleFile)}:fontsize=${titleSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(o.height * 0.05)}`,
    `drawbox=x=(iw-${barW})/2:y=(ih)/2+${Math.round(o.height * 0.045)}:w=${barW}:h=${barH}:color=${hex(o.accent)}@1:t=fill`,
    ...(o.subtitle && files.subtitleFile
      ? [
          `drawtext=expansion=none:font=${o.font}:textfile=${tf(files.subtitleFile)}:fontsize=${subSize}:fontcolor=0xB6C2CC:x=(w-text_w)/2:y=(h)/2+${Math.round(o.height * 0.075)}`,
        ]
      : []),
  ];
  return cardArgs(o, lines, out);
}

/** Title card with a large wrapped hook; the product title sits small beneath it. */
function hookTitleCardArgs(o: CardOpts, out: string, files: CardTextFiles, hookFiles: string[]): string[] {
  const layout = hookLayout(o.width, o.height, o.hook!);
  const step = Math.round(layout.fontSize * 1.2);
  const blockH = hookFiles.length * step;
  const titleSize = Math.round(o.height * 0.034);
  const barW = Math.round(o.width * 0.09);
  const barH = Math.max(4, Math.round(o.height * 0.007));
  const blockTop = Math.round(o.height / 2 - blockH / 2 - o.height * 0.06);
  const lines = [
    ...hookFiles.map(
      (f, i) => `drawtext=expansion=none:font=${o.font}:textfile=${tf(f)}:fontsize=${layout.fontSize}:fontcolor=white:x=(w-text_w)/2:y=${blockTop + i * step}`,
    ),
    `drawbox=x=(iw-${barW})/2:y=(ih)/2+${Math.round(blockH / 2)}:w=${barW}:h=${barH}:color=${hex(o.accent)}@1:t=fill`,
    `drawtext=expansion=none:font=${o.font}:textfile=${tf(files.titleFile)}:fontsize=${titleSize}:fontcolor=white:x=(w-text_w)/2:y=(h)/2+${Math.round(blockH / 2) + barH + Math.round(o.height * 0.015)}`,
    ...(o.subtitle && files.subtitleFile
      ? [
          `drawtext=expansion=none:font=${o.font}:textfile=${tf(files.subtitleFile)}:fontsize=${Math.round(titleSize * 0.8)}:fontcolor=0xB6C2CC:x=(w-text_w)/2:y=(h)/2+${Math.round(blockH / 2) + barH + Math.round(o.height * 0.015) + Math.round(titleSize * 1.5)}`,
        ]
      : []),
  ];
  return cardArgs(o, lines, out, false);
}

/** End card: title small, URL prominent in the accent color. */
export function endCardArgs(o: CardOpts, out: string, files: CardTextFiles): string[] {
  const titleSize = Math.round(o.height * 0.05);
  const urlSize = Math.round(o.height * 0.042);
  const lines = [
    `drawtext=expansion=none:font=${o.font}:textfile=${tf(files.titleFile)}:fontsize=${titleSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(o.height * 0.04)}`,
    ...(o.url && files.urlFile
      ? [
          `drawtext=expansion=none:font=${o.font}:textfile=${tf(files.urlFile)}:fontsize=${urlSize}:fontcolor=${hex(o.accent)}:x=(w-text_w)/2:y=(h)/2+${Math.round(o.height * 0.03)}`,
        ]
      : []),
  ];
  return cardArgs(o, lines, out);
}
