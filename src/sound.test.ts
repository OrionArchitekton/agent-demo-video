import { describe, it, expect } from "vitest";
import { ambientBedArgs, tickWavArgs, sweepWavArgs, soundscapeArgs } from "./sound";

describe("synthesized sources (S2)", () => {
  it("ambient bed is synthesized noise, bounded to the duration", () => {
    const j = ambientBedArgs(96.5, "/t/bed.wav").join(" ");
    expect(j).toContain("anoisesrc");
    expect(j).toContain("96.5");
    expect(j).toContain("/t/bed.wav");
  });
  it("tick and sweep are short synthesized one-shots", () => {
    expect(tickWavArgs("/t/tick.wav").join(" ")).toContain("sine=");
    expect(sweepWavArgs("/t/sweep.wav").join(" ")).toContain("anoisesrc");
  });
});

describe("soundscapeArgs", () => {
  const o = { bedDb: -28, ticks: true, sweeps: true };

  it("ducks the bed under narration, delays ticks/sweeps to their offsets, and never attenuates narration", () => {
    const args = soundscapeArgs("/t/narr.mp3", "/t/bed.wav", "/t/tick.wav", "/t/sweep.wav", [3.25, 10.5], [12.0], 30, o, "/t/mix.m4a");
    const j = args.join(" ");
    expect(j).toContain("sidechaincompress");
    expect(j).toContain("volume=-28dB");
    expect(j).toContain("adelay=3250|3250");
    expect(j).toContain("adelay=10500|10500");
    expect(j).toContain("adelay=12000|12000");
    expect(j).toContain("normalize=0");
    expect(j).toContain("-t 30");
  });

  it("omits tick/sweep inputs when there are no events and mixes only narration+bed", () => {
    const args = soundscapeArgs("/t/narr.mp3", "/t/bed.wav", "/t/tick.wav", "/t/sweep.wav", [], [], 30, o, "/t/mix.m4a");
    const j = args.join(" ");
    expect(j).not.toContain("adelay");
    expect(j).toContain("amix=inputs=2");
  });

  it("uses a looped music file instead of the bed when musicPath is set", () => {
    const args = soundscapeArgs("/t/narr.mp3", "/t/bed.wav", "/t/tick.wav", "/t/sweep.wav", [], [], 30, { ...o, musicPath: "/t/song.mp3" }, "/t/mix.m4a");
    const j = args.join(" ");
    expect(j).toContain("-stream_loop -1");
    expect(j).toContain("/t/song.mp3");
    expect(j).not.toContain("/t/bed.wav");
  });
});
