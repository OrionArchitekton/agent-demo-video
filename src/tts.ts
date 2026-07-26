import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Shot, DemoConfig, TtsResult } from "./types";
import { estimateDurationSec, synthAlignment } from "./fake-tts";
import { silentMp3Args, ffmpeg, probeDurationSec } from "./ffmpeg";

export type TtsMode = "fake" | "real";

/**
 * Decide whether narration is synthesised for real or faked as silent audio.
 *
 * Fake mode must be REQUESTED, never inferred. Inferring it from a missing key
 * meant a forgotten `doppler run` produced a complete, correctly-timed, captioned
 * video with no voice at all, and nothing downstream could see it: the estimated
 * duration IS the clock, so parity verification still passed.
 */
export function resolveTtsMode(
  env: { FAKE_TTS?: string; ELEVENLABS_API_KEY?: string } = process.env,
): TtsMode {
  if (env.FAKE_TTS === "1") return "fake";
  if (!env.ELEVENLABS_API_KEY) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set, so narration cannot be synthesised. " +
        "Supply it (e.g. `doppler run -p claude-code-use -c prd -- pnpm demo <config>`), " +
        "or set FAKE_TTS=1 to deliberately render silent placeholder narration.",
    );
  }
  return "real";
}

export async function synthShot(shot: Shot, config: DemoConfig, outDir: string): Promise<TtsResult> {
  await mkdir(outDir, { recursive: true });
  const audioPath = join(outDir, `${shot.id}.mp3`);

  if (resolveTtsMode() === "fake") {
    const durationSec = estimateDurationSec(shot.narration);
    const alignment = synthAlignment(shot.narration, durationSec);
    await ffmpeg(silentMp3Args(durationSec, audioPath));
    return { shotId: shot.id, audioPath, durationSec, alignment };
  }

  // REAL path: ElevenLabs with-timestamps
  const apiKey = process.env.ELEVENLABS_API_KEY!;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${config.voice.voiceId}/with-timestamps`;
  const body = {
    text: shot.narration,
    model_id: config.voice.modelId,
    seed: config.voice.seed,
    voice_settings: {
      stability: config.voice.stability,
      similarity_boost: config.voice.similarity,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs TTS failed with status ${res.status}: ${text}`);
  }

  const json = await res.json() as {
    audio_base64: string;
    alignment: {
      characters: string[];
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    };
  };

  const audioBuffer = Buffer.from(json.audio_base64, "base64");
  await writeFile(audioPath, audioBuffer);

  const alignment = {
    chars: json.alignment.characters,
    startSec: json.alignment.character_start_times_seconds,
    endSec: json.alignment.character_end_times_seconds,
  };

  const durationSec = await probeDurationSec(audioPath);
  return { shotId: shot.id, audioPath, durationSec, alignment };
}
