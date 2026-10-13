import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Shot, DemoConfig, TtsResult, TimingSource } from "./types";
import { DEFAULT_VOICE_TIMEOUT_SEC } from "./types";
import { estimateDurationSec, synthAlignment } from "./fake-tts";
import { silentMp3Args, ffmpeg, probeDurationSec } from "./ffmpeg";
import { runCommand, readWordsFile } from "./command-voice";
import { alignScriptWords, MIN_COVERAGE } from "./word-timing";

const MIN_AUDIO_SEC = 0.3;

async function synthCommandShot(shot: Shot, config: DemoConfig, outDir: string): Promise<TtsResult> {
  const v = config.voice;
  const label = `voice command (shot ${shot.id})`;
  const audioPath = join(outDir, `${shot.id}.wav`);
  const textPath = join(outDir, `${shot.id}.txt`);
  await writeFile(textPath, shot.narration, "utf8");
  await rm(audioPath, { force: true });
  await rm(`${audioPath}.words.json`, { force: true });
  await runCommand(label, v.command!, { text: textPath, out: audioPath }, v.timeoutSec ?? DEFAULT_VOICE_TIMEOUT_SEC);
  if (!existsSync(audioPath)) throw new Error(`${label}: wrote no audio at ${audioPath}`);
  let durationSec: number;
  try {
    durationSec = await probeDurationSec(audioPath);
  } catch (e) {
    throw new Error(`${label}: cannot read audio at ${audioPath}: ${(e as Error).message}`);
  }
  if (!(durationSec >= MIN_AUDIO_SEC)) throw new Error(`${label}: audio is ${durationSec}s, under the ${MIN_AUDIO_SEC}s minimum`);

  let words = await readWordsFile(`${audioPath}.words.json`, label);
  // An empty list is "no timings": fall through to the aligner or the estimate.
  if (words && words.length === 0) words = null;
  let timing: TimingSource = "provider";
  let source = label;
  if (!words && v.aligner) {
    source = `aligner (shot ${shot.id})`;
    const wordsPath = join(outDir, `${shot.id}.aligned.json`);
    await rm(wordsPath, { force: true });
    await runCommand(source, v.aligner, { audio: audioPath, text: textPath, out: wordsPath }, v.timeoutSec ?? DEFAULT_VOICE_TIMEOUT_SEC);
    words = await readWordsFile(wordsPath, source);
    if (!words) throw new Error(`${source}: wrote no word timings at ${wordsPath}`);
    timing = "aligned";
  }
  if (!words) {
    return { shotId: shot.id, audioPath, durationSec, alignment: synthAlignment(shot.narration, durationSec), timing: "estimated" };
  }
  const { alignment, coverage } = alignScriptWords(shot.narration, words, durationSec);
  if (coverage < MIN_COVERAGE) {
    throw new Error(`${source}: word timings match only ${Math.round(coverage * 100)}% of the script's words (need ${MIN_COVERAGE * 100}%); wrong or truncated take?`);
  }
  return { shotId: shot.id, audioPath, durationSec, alignment, timing };
}

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
  provider: DemoConfig["voice"]["provider"] = "elevenlabs",
): TtsMode {
  if (env.FAKE_TTS === "1") return "fake";
  if (provider === "command") return "real";
  if (!env.ELEVENLABS_API_KEY) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set, so narration cannot be synthesised. " +
        "Supply it from your secret manager (e.g. `doppler run -- pnpm demo <config>`), " +
        "use voice.provider \"command\" with your own voice command, " +
        "or set FAKE_TTS=1 to deliberately render silent placeholder narration.",
    );
  }
  return "real";
}

export async function synthShot(shot: Shot, config: DemoConfig, outDir: string): Promise<TtsResult> {
  await mkdir(outDir, { recursive: true });
  const audioPath = join(outDir, `${shot.id}.mp3`);

  if (resolveTtsMode(process.env, config.voice.provider) === "fake") {
    const durationSec = estimateDurationSec(shot.narration);
    const alignment = synthAlignment(shot.narration, durationSec);
    await ffmpeg(silentMp3Args(durationSec, audioPath));
    return { shotId: shot.id, audioPath, durationSec, alignment, timing: "estimated" };
  }

  if (config.voice.provider === "command") return synthCommandShot(shot, config, outDir);

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
  return { shotId: shot.id, audioPath, durationSec, alignment, timing: "provider" };
}
