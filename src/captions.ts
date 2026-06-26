import type { Alignment } from "./types";

/**
 * Build a libass `force_style` string for burned captions.
 *
 * Default look is a fixed lower-third band: white text in a semi-opaque box
 * (BorderStyle=3 + translucent BackColour) with consistent padding (Outline)
 * and a bottom margin (MarginV), bottom-centre aligned. This keeps every cue
 * readable and uniformly placed regardless of length, instead of long cues
 * climbing over the content. Set captionBox=false for plain outline+shadow.
 *
 * Note: SRT carries no PlayRes, so libass sizes FontSize/MarginV in its
 * 384x288 reference space, scaled to the output frame.
 */
export function captionStyle(theme: {
  captionFont: string;
  captionSize: number;
  captionBox?: boolean;
  captionMarginV?: number;
}): string {
  const parts = [
    `FontName=${theme.captionFont}`,
    `FontSize=${theme.captionSize}`,
    `PrimaryColour=&H00FFFFFF`,
    `Alignment=2`,
    `MarginV=${theme.captionMarginV ?? 20}`,
  ];
  if (theme.captionBox ?? true) {
    // Opaque-box border style with a ~80%-opaque black background + padding.
    parts.push(`BorderStyle=3`, `BackColour=&H30000000`, `Outline=6`, `Shadow=0`);
  } else {
    parts.push(`BorderStyle=1`, `Outline=2`, `Shadow=1`);
  }
  return parts.join(",");
}

function fmt(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

/**
 * Produce one SRT cue per shot: full narration text spanning
 * [startSec + first-char-start, startSec + last-char-end].
 * Shots with empty alignment are skipped.
 */
export function toSrt(shots: { alignment: Alignment; startSec: number }[]): string {
  const cues: { start: number; end: number; text: string }[] = [];
  for (const shot of shots) {
    const { alignment, startSec } = shot;
    if (alignment.chars.length === 0) continue;
    const start = startSec + alignment.startSec[0]!;
    const end = startSec + alignment.endSec[alignment.endSec.length - 1]!;
    const text = alignment.chars.join("").trim();
    cues.push({ start, end, text });
  }
  return cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}`).join("\n\n") + "\n";
}
