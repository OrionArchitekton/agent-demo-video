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

interface Word { text: string; start: number; end: number }

/** Group per-character alignment into words with absolute times. */
function alignmentWords(alignment: Alignment, startSec: number): Word[] {
  const words: Word[] = [];
  let text = "";
  let start = 0;
  let end = 0;
  for (let i = 0; i < alignment.chars.length; i++) {
    const ch = alignment.chars[i]!;
    if (/\s/.test(ch)) {
      if (text) words.push({ text, start: startSec + start, end: startSec + end });
      text = "";
      continue;
    }
    if (!text) start = alignment.startSec[i]!;
    text += ch;
    end = alignment.endSec[i]!;
  }
  if (text) words.push({ text, start: startSec + start, end: startSec + end });
  return words;
}

const assTime = (t: number): string => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), r = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(r).padStart(2, "0")}`;
};

const assEscape = (t: string): string => t.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");

/** #rrggbb -> ASS &HBBGGRR& override color. */
const assColor = (hexColor: string): string => {
  const h = hexColor.replace(/^#/, "");
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
};

export interface WordAssStyle {
  width: number;
  height: number;
  font: string;
  fontSize: number;
  /** Accent color for the word currently being spoken (#rrggbb). */
  accent: string;
  marginV: number;
  maxWordsPerLine?: number;
}

/**
 * Word-pop captions (production-polish S3): one accumulating Dialogue event
 * per spoken word — the current line grows word by word, the active word
 * rendered in the accent color. PlayRes matches the output frame so fontSize
 * and margins are true pixels (unlike SRT's 384x288 reference).
 */
export function toWordAss(shots: { alignment: Alignment; startSec: number }[], style: WordAssStyle): string {
  const maxWords = style.maxWordsPerLine ?? 7;
  const accent = assColor(style.accent);
  const events: string[] = [];

  for (const shot of shots) {
    const words = alignmentWords(shot.alignment, shot.startSec);
    for (let lineStart = 0; lineStart < words.length; lineStart += maxWords) {
      const line = words.slice(lineStart, lineStart + maxWords);
      for (let i = 0; i < line.length; i++) {
        const shown = line.slice(0, i + 1);
        const evStart = line[i]!.start;
        const evEnd = i + 1 < line.length ? line[i + 1]!.start : line[line.length - 1]!.end + 0.15;
        const text = shown
          .map((w, j) => (j === i ? `{\\c${accent}}${assEscape(w.text)}{\\c&HFFFFFF&}` : assEscape(w.text)))
          .join(" ");
        events.push(`Dialogue: 0,${assTime(evStart)},${assTime(evEnd)},Pop,,0,0,0,,${text}`);
      }
    }
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${style.width}`,
    `PlayResY: ${style.height}`,
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Pop,${style.font},${style.fontSize},&H00FFFFFF,&H00FFFFFF,&H00101418,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,60,60,${style.marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
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
