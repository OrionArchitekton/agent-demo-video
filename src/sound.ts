/**
 * sound.ts — synthesized sound design (production-polish S2)
 *
 * A subtle ambient bed under the narration (auto-ducked via sidechain), a soft
 * tick at each recorded click, and a quiet sweep at segment boundaries. Every
 * source is synthesized by ffmpeg at render time: no bundled media, no
 * licensing surface. Pure module: argument builders only.
 */

const BASE = ["-y", "-hide_banner", "-loglevel", "error"];

export interface SoundOpts {
  /** Bed level under narration, in dB (negative). */
  bedDb: number;
  ticks: boolean;
  sweeps: boolean;
  /** Optional operator-supplied music file replacing the synthesized bed. */
  musicPath?: string;
}

/** Brown-noise ambient drone, lowpassed with a slow amplitude wobble. */
export function ambientBedArgs(durationSec: number, out: string): string[] {
  return [
    ...BASE,
    "-f", "lavfi",
    "-i", `anoisesrc=color=brown:sample_rate=44100:duration=${durationSec}`,
    "-af", "lowpass=f=300,highpass=f=45,tremolo=f=0.12:d=0.22,volume=6dB",
    out,
  ];
}

/** 50ms soft click: a fast-decaying sine burst. */
export function tickWavArgs(out: string): string[] {
  return [
    ...BASE,
    "-f", "lavfi",
    "-i", "sine=frequency=1050:sample_rate=44100:duration=0.05",
    "-af", "afade=t=out:st=0.012:d=0.038,volume=-16dB",
    out,
  ];
}

/** 400ms transition sweep: bandpassed noise faded in and out. */
export function sweepWavArgs(out: string): string[] {
  return [
    ...BASE,
    "-f", "lavfi",
    "-i", "anoisesrc=color=pink:sample_rate=44100:duration=0.4",
    "-af", "bandpass=f=900:w=500,afade=t=in:d=0.15,afade=t=out:st=0.15:d=0.25,volume=-20dB",
    out,
  ];
}

const ms = (sec: number) => Math.round(sec * 1000);

/**
 * Mix narration + ducked bed + positioned one-shots into the final track.
 * amix normalize=0 keeps narration at unity (default amix attenuates by input
 * count). Bounded by -t so the mix can never outrun the video.
 */
export function soundscapeArgs(
  narration: string,
  bed: string,
  tick: string,
  sweep: string,
  tickTimesSec: number[],
  sweepTimesSec: number[],
  durationSec: number,
  o: SoundOpts,
  out: string,
): string[] {
  const ticks = o.ticks ? tickTimesSec : [];
  const sweeps = o.sweeps ? sweepTimesSec : [];

  const inputs: string[] = ["-i", narration];
  if (o.musicPath) {
    inputs.push("-stream_loop", "-1", "-i", o.musicPath);
  } else {
    inputs.push("-i", bed);
  }
  for (let i = 0; i < ticks.length; i++) inputs.push("-i", tick);
  for (let i = 0; i < sweeps.length; i++) inputs.push("-i", sweep);

  const parts: string[] = [];
  // Bed at its level, then ducked with the narration as the sidechain key.
  parts.push(`[1:a]volume=${o.bedDb}dB[bed0]`);
  parts.push(`[bed0][0:a]sidechaincompress=threshold=0.015:ratio=8:attack=120:release=700[duck]`);
  const mixIns: string[] = ["[0:a]", "[duck]"];
  let idx = 2;
  for (const t of ticks) {
    parts.push(`[${idx}:a]adelay=${ms(t)}|${ms(t)}[t${idx}]`);
    mixIns.push(`[t${idx}]`);
    idx++;
  }
  for (const t of sweeps) {
    parts.push(`[${idx}:a]adelay=${ms(t)}|${ms(t)}[s${idx}]`);
    mixIns.push(`[s${idx}]`);
    idx++;
  }
  parts.push(`${mixIns.join("")}amix=inputs=${mixIns.length}:duration=first:normalize=0[mix]`);

  return [
    ...BASE,
    ...inputs,
    "-filter_complex", parts.join(";"),
    "-map", "[mix]",
    "-t", String(durationSec),
    "-c:a", "aac",
    out,
  ];
}
