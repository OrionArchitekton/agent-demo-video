/**
 * cards.ts — branded title and end cards (production-polish S5)
 *
 * Rendered as ordinary silent segments on the backdrop gradient: a ~2s cold
 * open with the product name, and a ~3s end card with the URL. Pure module:
 * ffmpeg argument builders only.
 */

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
  url?: string;
  fadeSec?: number;
}

/** Escape drawtext-significant characters (backslash, quote, colon, percent). */
export function drawtextEscape(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\\\\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

const hex = (c: string): string => "0x" + c.replace(/^#/, "");

function gradientInput(o: CardOpts): string[] {
  const grad = `gradients=s=${o.width}x${o.height}:c0=${hex(o.backdropTop)}:c1=${hex(o.backdropBottom)}:x0=${Math.round(o.width / 2)}:y0=0:x1=${Math.round(o.width / 2)}:y1=${o.height}:d=${Math.ceil(o.durationSec + 1)}`;
  return ["-f", "lavfi", "-i", grad];
}

function cardArgs(o: CardOpts, lines: string[], out: string): string[] {
  const fade = o.fadeSec ?? 0.4;
  const vf = [
    ...lines,
    `fade=t=in:st=0:d=${fade}`,
    `fade=t=out:st=${Math.max(0, o.durationSec - fade)}:d=${fade}`,
    `fps=${o.fps}`,
    "format=yuv420p",
  ].join(",");
  return [
    ...BASE,
    ...gradientInput(o),
    "-t", String(o.durationSec),
    "-vf", vf,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an",
    out,
  ];
}

/** Cold-open title card: product name, optional subtitle, accent underline. */
export function titleCardArgs(o: CardOpts, out: string): string[] {
  const titleSize = Math.round(o.height * 0.085);
  const subSize = Math.round(o.height * 0.034);
  const barW = Math.round(o.width * 0.09);
  const barH = Math.max(4, Math.round(o.height * 0.007));
  const lines = [
    `drawtext=font=${o.font}:text='${drawtextEscape(o.title)}':fontsize=${titleSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(o.height * 0.05)}`,
    `drawbox=x=(iw-${barW})/2:y=(ih)/2+${Math.round(o.height * 0.045)}:w=${barW}:h=${barH}:color=${hex(o.accent)}@1:t=fill`,
    ...(o.subtitle
      ? [
          `drawtext=font=${o.font}:text='${drawtextEscape(o.subtitle)}':fontsize=${subSize}:fontcolor=0xB6C2CC:x=(w-text_w)/2:y=(h)/2+${Math.round(o.height * 0.075)}`,
        ]
      : []),
  ];
  return cardArgs(o, lines, out);
}

/** End card: title small, URL prominent in the accent color. */
export function endCardArgs(o: CardOpts, out: string): string[] {
  const titleSize = Math.round(o.height * 0.05);
  const urlSize = Math.round(o.height * 0.042);
  const lines = [
    `drawtext=font=${o.font}:text='${drawtextEscape(o.title)}':fontsize=${titleSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(o.height * 0.04)}`,
    ...(o.url
      ? [
          `drawtext=font=${o.font}:text='${drawtextEscape(o.url)}':fontsize=${urlSize}:fontcolor=${hex(o.accent)}:x=(w-text_w)/2:y=(h)/2+${Math.round(o.height * 0.03)}`,
        ]
      : []),
  ];
  return cardArgs(o, lines, out);
}
