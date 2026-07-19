/**
 * framing.ts — scene framing: the capture floats as a rounded, shadowed window
 * on a gradient backdrop (production-polish S1).
 *
 * Pure module: builds ffmpeg argument lists only. The rounded-corner alpha mask
 * and the shadow plate are generated ONCE per render as single-frame PNGs (geq
 * is per-pixel and slow, so it never runs per frame); the per-segment composite
 * then uses only fast filters (scale, alphamerge, overlay).
 */

const BASE = ["-y", "-hide_banner", "-loglevel", "error"];

export interface FrameOpts {
  width: number;
  height: number;
  /** Window scale relative to the output frame (0..1). */
  scale: number;
  /** Corner radius in output pixels. */
  radius: number;
  backdropTop: string;
  backdropBottom: string;
  shadow: boolean;
}

/** Scaled window size, forced even (h264 yuv420 chroma subsampling). */
export function scaledSize(width: number, height: number, scale: number): { width: number; height: number } {
  const even = (n: number) => Math.round(n / 2) * 2;
  return { width: even(width * scale), height: even(height * scale) };
}

/** #rrggbb -> ffmpeg 0xRRGGBB. */
function hex(c: string): string {
  return "0x" + c.replace(/^#/, "");
}

/**
 * Rounded-rectangle alpha expression for geq on a WxH frame with radius R:
 * fully opaque inside; a quarter-circle test only in the corner squares.
 */
function roundedAlphaExpr(w: number, h: number, r: number): string {
  const cx = `abs(${w / 2}-X)-(${w / 2 - r})`;
  const cy = `abs(${h / 2}-Y)-(${h / 2 - r})`;
  return `if(gt(${cx},0)*gt(${cy},0),if(lte(hypot(${cx},${cy}),${r}),255,0),255)`;
}

/**
 * One-frame PNG: LUMA mask (white inside the rounded rect, black outside) at
 * the scaled window size. alphamerge consumes the second input's grayscale
 * value as alpha, so the mask must encode shape in luma, not in an alpha
 * channel (a white-but-transparent pixel would read as fully opaque).
 */
export function maskGenArgs(o: FrameOpts, outPng: string): string[] {
  const s = scaledSize(o.width, o.height, o.scale);
  return [
    ...BASE,
    "-f", "lavfi",
    "-i", `color=c=black:s=${s.width}x${s.height}`,
    "-frames:v", "1",
    "-vf", `format=gray,geq=lum='${roundedAlphaExpr(s.width, s.height, o.radius)}'`,
    outPng,
  ];
}

/** Extra canvas around the shadow plate so the blur has room to spread. */
export const SHADOW_PAD = 64;

/** One-frame PNG: blurred dark rounded rect on a transparent, padded canvas. */
export function shadowGenArgs(o: FrameOpts, outPng: string): string[] {
  const s = scaledSize(o.width, o.height, o.scale);
  const w = s.width + SHADOW_PAD * 2;
  const h = s.height + SHADOW_PAD * 2;
  const inner = roundedAlphaExpr(s.width, s.height, o.radius);
  // Alpha: rounded rect inset by SHADOW_PAD, then blurred to a soft plate.
  const a = `if(between(X,${SHADOW_PAD},${SHADOW_PAD + s.width - 1})*between(Y,${SHADOW_PAD},${SHADOW_PAD + s.height - 1}),0.55*${inner.replace(/\bX\b/g, `(X-${SHADOW_PAD})`).replace(/\bY\b/g, `(Y-${SHADOW_PAD})`)},0)`;
  return [
    ...BASE,
    "-f", "lavfi",
    "-i", `color=c=black:s=${w}x${h}`,
    "-frames:v", "1",
    "-vf", `format=rgba,geq=r=0:g=0:b=0:a='${a}',boxblur=24:2`,
    outPng,
  ];
}

/**
 * Composite one segment into the framed scene: animated gradient backdrop,
 * shadow plate (optional), rounded window centered, CFR, optional fade-in.
 * Output is silent video (-an), same contract as normalizeArgs.
 */
export function frameArgs(
  input: string,
  maskPng: string,
  shadowPng: string | null,
  output: string,
  o: FrameOpts & { fps: number; durationSec: number; fadeInSec?: number },
): string[] {
  const s = scaledSize(o.width, o.height, o.scale);
  const grad = `gradients=s=${o.width}x${o.height}:c0=${hex(o.backdropTop)}:c1=${hex(o.backdropBottom)}:x0=${Math.round(o.width / 2)}:y0=0:x1=${Math.round(o.width / 2)}:y1=${o.height}:d=${Math.ceil(o.durationSec + 2)}`;
  const inputs = [
    "-i", input,
    "-i", maskPng,
    ...(shadowPng ? ["-i", shadowPng] : []),
    "-f", "lavfi", "-i", grad,
  ];
  const bgIdx = shadowPng ? 3 : 2;
  const fade = o.fadeInSec && o.fadeInSec > 0 ? `,fade=t=in:st=0:d=${o.fadeInSec}` : "";
  const shadowChain = shadowPng
    ? `[${bgIdx}:v]format=yuv420p[bg];[bg][2:v]overlay=(W-w)/2:(H-h)/2+14[bg2];`
    : `[${bgIdx}:v]format=yuv420p[bg2];`;
  const fc =
    shadowChain +
    `[0:v]scale=${s.width}:${s.height}:force_original_aspect_ratio=decrease,pad=${s.width}:${s.height}:(ow-iw)/2:(oh-ih)/2[sv];` +
    `[sv][1:v]alphamerge[win];` +
    `[bg2][win]overlay=(W-w)/2:(H-h)/2:shortest=1[ov];` +
    `[ov]fps=${o.fps}${fade},format=yuv420p[out]`;
  return [
    ...BASE,
    ...inputs,
    "-filter_complex", fc,
    "-map", "[out]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an",
    output,
  ];
}
