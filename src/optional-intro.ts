import { constants } from "node:fs";
import { chmod, mkdir, mkdtemp, open, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { DemoConfig } from "./types";
import { digestFile } from "./provenance";
import { parseDeliverableProbe, probeDurationSec } from "./ffmpeg";
import { runCommand } from "./command-voice";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z.object({
  version: z.literal(1), sourceSha256: sha256, sourceStartSec: z.literal(0),
  durationSec: z.number().min(3).max(4), assetSha256: sha256,
  width: z.number().int().positive(), height: z.number().int().positive(),
  fps: z.number().positive(), recipeId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
}).strict();

export interface IntroAsset {
  path: string;
  inputRoot: string;
  byteLength: number;
  sha256: string;
  sourceSha256: string;
  durationSec: number;
  recipeId: string;
}
export interface IntroRecord {
  requested: true;
  used: boolean;
  fallbackReason?: string;
  renderer?: string;
  asset?: Omit<IntroAsset, "path" | "inputRoot">;
}
export interface PreparedIntro {
  record: IntroRecord;
  asset?: IntroAsset;
}

const assetIdentitySchema = z.object({
  byteLength: z.number().int().positive().safe(), sha256, sourceSha256: sha256,
  durationSec: z.number().min(3).max(4), recipeId: receiptSchema.shape.recipeId,
});
export const portableIntroSchema = z.object({
  record: z.object({ requested: z.literal(true), used: z.boolean(),
    fallbackReason: z.string().optional(), renderer: z.string().optional(),
    asset: assetIdentitySchema.strict().optional(),
  }).strict(),
  asset: assetIdentitySchema.extend({ file: z.literal("optional/intro.mp4") }).strict().optional(),
}).strict();

/** Resolve both lexical and real paths; symlinks cannot escape staged inputs. */
export async function containedIntroPath(root: string, path: string): Promise<string> {
  const inside = (base: string, file: string) => {
    const rel = relative(base, file);
    return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
  };
  if (!inside(resolve(root), resolve(path)) || !inside(await realpath(root), await realpath(path))) {
    throw new Error("optional intro staged path escapes input root");
  }
  return path;
}

/** Snapshot through an opened regular file, never a FIFO, directory or symlink. */
async function snapshot(source: string, dest: string, maxBytes = Infinity): Promise<void> {
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await input.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error("optional intro input is not an eligible regular file");
    const output = await open(dest, "wx", 0o600);
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let offset = 0;
      for (;;) {
        const { bytesRead } = await input.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) break;
        if (offset + bytesRead > maxBytes) throw new Error("optional intro input exceeds size limit");
        let written = 0;
        while (written < bytesRead) written += (await output.write(buffer, written, bytesRead - written)).bytesWritten;
        offset += bytesRead;
      }
    } finally { await output.close(); }
  } finally { await input.close(); }
}

/** Only preparation failures may select the legacy shot. Main rendering never calls this. */
export async function prepareIntro(config: DemoConfig, source: string): Promise<PreparedIntro | undefined> {
  const choice = config.optionalIntro;
  if (!choice) return undefined;
  const parent = join(config.out, "optional-intro");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const inputRoot = await mkdtemp(join(parent, "attempt-"));
  const persist = async (value: PreparedIntro): Promise<PreparedIntro> => {
    await writeFile(join(inputRoot, "preparation.json"), JSON.stringify(value.record, null, 2));
    return value;
  };
  const skipped = (fallbackReason: string): PreparedIntro => ({ record: { requested: true, used: false, fallbackReason } });
  if (config.brand?.titleCard) return persist(skipped("title_card_enabled"));
  // Source failures are ordinary capture/integrity failures, outside optional fallback.
  const sourceDuration = await probeDurationSec(source);
  if (!Number.isFinite(sourceDuration)) throw new Error("invalid first capture duration");
  if (sourceDuration + 1e-6 < choice.durationSec) return persist(skipped("source_too_short"));
  if (!choice.asset && !choice.renderer) return persist(skipped("missing_renderer"));
  const path = join(inputRoot, "intro.mp4");
  const sourceSha256 = await digestFile(source);
  const deadline = Date.now() + choice.timeoutSec * 1000;
  const remainingSec = () => Math.max(0.001, (deadline - Date.now()) / 1000);
  const renderer = choice.renderer ? basename(choice.renderer[0]!) : "prepared_asset";
  let prepared: PreparedIntro;
  try {
    let candidate: string;
    let receiptPath: string;
    if (choice.renderer) {
      const sourceCopy = join(inputRoot, "source.mp4");
      await snapshot(source, sourceCopy);
      if (await digestFile(sourceCopy) !== sourceSha256) throw new Error("source changed during preparation");
      await chmod(sourceCopy, 0o400);
      candidate = join(inputRoot, "candidate.mp4");
      receiptPath = join(inputRoot, "candidate.json");
      const request = join(inputRoot, "request.json");
      await writeFile(request, JSON.stringify({ version: 1, sourceSha256, sourceStartSec: 0,
        durationSec: choice.durationSec, ...config.resolution, fps: config.fps }));
      await runCommand("optional intro renderer", choice.renderer, {
        source: sourceCopy, out: candidate, receipt: receiptPath, request,
        duration: String(choice.durationSec), width: String(config.resolution.width),
        height: String(config.resolution.height), fps: String(config.fps),
      }, remainingSec(), { gracefulKillMs: 5000, env: optionalToolEnv() });
      if (await digestFile(sourceCopy) !== sourceSha256) throw new Error("renderer changed its source snapshot");
    } else {
      candidate = resolve(config.configDir ?? process.cwd(), choice.asset!);
      receiptPath = resolve(config.configDir ?? process.cwd(), choice.receipt ?? `${choice.asset}.json`);
    }
    await snapshot(candidate, path);
    const receiptCopy = join(inputRoot, "receipt.json");
    await snapshot(receiptPath, receiptCopy, 16384);
    const receipt = receiptSchema.parse(JSON.parse(await readFile(receiptCopy, "utf8")));
    const hash = await digestFile(path);
    const probeLog = join(inputRoot, "probe.json");
    await runCommand("optional intro probe", ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", "{video}"],
      { video: path }, remainingSec(), { gracefulKillMs: 5000, env: optionalToolEnv(), logPath: probeLog });
    const probe = parseDeliverableProbe(JSON.parse(await readFile(probeLog, "utf8")));
    const rate = (probe.frameRate ?? "").split("/").map(Number);
    const fps = rate[0]! / rate[1]!;
    if (receipt.sourceSha256 !== sourceSha256 || receipt.assetSha256 !== hash ||
        receipt.durationSec !== choice.durationSec || receipt.width !== config.resolution.width ||
        receipt.height !== config.resolution.height || receipt.fps !== config.fps ||
        probe.width !== config.resolution.width || probe.height !== config.resolution.height ||
        probe.sampleAspectRatio !== "1:1" || probe.rotationDeg !== 0 ||
        probe.videoStreams !== 1 || probe.audioStreams !== 0 || fps !== config.fps ||
        probe.videoDurationSec === null || Math.abs(probe.videoDurationSec - choice.durationSec) > 0.5 / config.fps) {
      throw new Error("intro candidate or receipt does not match source, interval, canvas or frame rate");
    }
    await runCommand("optional intro decode", ["ffmpeg", "-v", "error", "-xerror", "-i", "{video}", "-map", "0:v:0", "-f", "null", "-"],
      { video: path }, remainingSec(), { gracefulKillMs: 5000, env: optionalToolEnv() });
    const asset: IntroAsset = { path, inputRoot, sha256: hash, sourceSha256,
      byteLength: (await stat(path)).size, durationSec: choice.durationSec, recipeId: receipt.recipeId };
    await chmod(path, 0o400);
    const { path: _path, inputRoot: _root, ...identity } = asset;
    prepared = { asset, record: { requested: true, used: true, renderer, asset: identity } };
  } catch (error) {
    const msg = (error as Error).message;
    const reason = msg.includes("timed out") ? "renderer_timeout" :
      msg.includes("program not found") ? "renderer_unavailable" : "invalid_candidate";
    prepared = { record: { ...skipped(reason).record, renderer } };
  }
  return persist(prepared);
}

/** Optional scene/check tools inherit executable discovery, never provider credentials. */
export function optionalToolEnv(): Record<string, string> {
  return Object.fromEntries(["PATH", "LANG", "LC_ALL", "TMPDIR", "SYSTEMROOT"].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
}

/** Fatal integrity check at each consumer, including after remote transport. */
export async function verifyIntro(intro: PreparedIntro | undefined, source: string): Promise<void> {
  if (!intro) return;
  if (intro.record.used !== Boolean(intro.asset)) throw new Error("optional intro state does not match staged asset");
  if (!intro.asset) return;
  const a = intro.asset;
  await containedIntroPath(a.inputRoot, a.path);
  const info = await stat(a.path);
  if (!info.isFile() || info.size !== a.byteLength || await digestFile(a.path) !== a.sha256 ||
      await digestFile(source) !== a.sourceSha256) {
    throw new Error("optional intro staged input integrity failure");
  }
  const { path: _path, inputRoot: _root, ...identity } = a;
  if (!intro.record.asset || Object.entries(identity).some(([k, v]) => intro.record.asset![k as keyof typeof identity] !== v)) {
    throw new Error("optional intro receipt identity mismatch");
  }
}
