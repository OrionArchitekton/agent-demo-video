import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, stat, writeFile, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { DemoConfig } from "./types";
import { parseDeliverableProbe } from "./ffmpeg";
import { runCommand } from "./command-voice";
import { FRAME_RATE_EPSILON, frameRateValue } from "./verify";

const MAX_INTRO_BYTES = 512 * 1024 * 1024;
const MAX_PROBE_OUTPUT_BYTES = 1024 * 1024;

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
  sourceSha256?: string;
  fallbackReason?: string;
  renderer?: string;
  asset?: Omit<IntroAsset, "path" | "inputRoot">;
}
export interface PreparedIntro {
  record: IntroRecord;
  asset?: IntroAsset;
}

const assetIdentitySchema = z.object({
  byteLength: z.number().int().positive().safe().max(MAX_INTRO_BYTES), sha256, sourceSha256: sha256,
  durationSec: z.number().min(3).max(4), recipeId: receiptSchema.shape.recipeId,
});
export const portableIntroSchema = z.object({
  record: z.object({ requested: z.literal(true), used: z.boolean(),
    sourceSha256: sha256.optional(),
    fallbackReason: z.string().optional(), renderer: z.string().optional(),
    asset: assetIdentitySchema.strict().optional(),
  }).strict(),
  asset: assetIdentitySchema.extend({ file: z.literal("optional/intro.mp4") }).strict().optional(),
}).strict();

class SourceIntegrityError extends Error {
  constructor(cause?: unknown) { super("optional intro source integrity failure", { cause }); }
}

class PreparationLimitError extends Error {
  constructor(readonly reason: "renderer_timeout" | "asset_too_large") { super(reason); }
}

function checkDeadline(deadline: number): void {
  if (Date.now() >= deadline) throw new PreparationLimitError("renderer_timeout");
}

async function hashWithBudget(path: string, deadline = Infinity): Promise<string> {
  checkDeadline(deadline);
  const input = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await input.stat();
    if (!info.isFile()) throw new Error("intro input is not a regular file");
    if (info.size > MAX_INTRO_BYTES) throw new PreparationLimitError("asset_too_large");
    const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    for (;;) {
      checkDeadline(deadline);
      const { bytesRead } = await input.read(buffer, 0, buffer.length, bytes);
      checkDeadline(deadline);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > MAX_INTRO_BYTES) throw new PreparationLimitError("asset_too_large");
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (bytes !== info.size || (await input.stat()).size !== info.size) throw new Error("intro input changed while hashing");
    return hash.digest("hex");
  } finally { await input.close(); }
}

async function assertSourceIdentity(path: string, expected: string, deadline = Infinity): Promise<void> {
  try {
    if (await hashWithBudget(path, deadline) !== expected) throw new SourceIntegrityError();
  } catch (error) {
    if (error instanceof PreparationLimitError && error.reason === "renderer_timeout") throw error;
    throw error instanceof SourceIntegrityError ? error : new SourceIntegrityError(error);
  }
}

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
async function snapshot(source: string, dest: string, maxBytes = MAX_INTRO_BYTES, deadline = Infinity): Promise<void> {
  checkDeadline(deadline);
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await input.stat();
    if (!info.isFile()) throw new Error("optional intro input is not an eligible regular file");
    if (info.size > maxBytes) throw new PreparationLimitError("asset_too_large");
    const output = await open(dest, "wx", 0o600);
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let offset = 0;
      for (;;) {
        checkDeadline(deadline);
        const { bytesRead } = await input.read(buffer, 0, buffer.length, offset);
        checkDeadline(deadline);
        if (!bytesRead) break;
        if (offset + bytesRead > maxBytes) throw new PreparationLimitError("asset_too_large");
        let written = 0;
        while (written < bytesRead) {
          checkDeadline(deadline);
          written += (await output.write(buffer, written, bytesRead - written)).bytesWritten;
        }
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
  const skipped = (fallbackReason: string, sourceSha256?: string): PreparedIntro => ({ record: {
    requested: true, used: false, fallbackReason, ...(sourceSha256 ? { sourceSha256 } : {}),
  } });
  if (config.brand?.titleCard) return persist(skipped("title_card_enabled"));
  const deadline = Date.now() + choice.timeoutSec * 1000;
  const remainingSec = () => Math.max(0.001, (deadline - Date.now()) / 1000);
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isFile()) throw new SourceIntegrityError();
  if (sourceInfo.size > MAX_INTRO_BYTES) return persist(skipped("source_too_large"));
  const sourceCopy = join(inputRoot, "source.mp4");
  let sourceSha256 = "";
  try {
    // Duration, identity and renderer input all describe the same private bytes.
    await snapshot(source, sourceCopy, MAX_INTRO_BYTES, deadline);
    sourceSha256 = await hashWithBudget(sourceCopy, deadline);
    await assertSourceIdentity(source, sourceSha256, deadline);
    await chmod(sourceCopy, 0o400);
  } catch (error) {
    if (error instanceof PreparationLimitError) return persist(skipped(error.reason, sourceSha256));
    throw new SourceIntegrityError(error);
  }
  // Source failures are ordinary capture/integrity failures, outside optional fallback.
  let sourceDuration: number;
  try {
    const sourceProbe = join(inputRoot, "source-probe.json");
    await runCommand("optional intro source probe", ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", "{source}"],
      { source: sourceCopy }, remainingSec(), { gracefulKillMs: 5000, env: optionalToolEnv(), logPath: sourceProbe,
        maxOutputBytes: MAX_PROBE_OUTPUT_BYTES });
    sourceDuration = Number(JSON.parse(await readFile(sourceProbe, "utf8")).format?.duration);
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new SourceIntegrityError();
    await assertSourceIdentity(source, sourceSha256, deadline);
  } catch (error) {
    if (error instanceof PreparationLimitError || (error as Error).message.includes("timed out")) {
      return persist(skipped("renderer_timeout", sourceSha256));
    }
    throw new SourceIntegrityError(error);
  }
  if (sourceDuration + 1e-6 < choice.durationSec) return persist(skipped("source_too_short", sourceSha256));
  if (!choice.asset && !choice.renderer) return persist(skipped("missing_renderer", sourceSha256));
  const path = join(inputRoot, "intro.mp4");
  const renderer = choice.renderer ? basename(choice.renderer[0]!) : "prepared_asset";
  let prepared: PreparedIntro;
  try {
    let candidate: string;
    let receiptPath: string;
    if (choice.renderer) {
      candidate = join(inputRoot, "candidate.mp4");
      receiptPath = join(inputRoot, "candidate.json");
      const request = join(inputRoot, "request.json");
      await writeFile(request, JSON.stringify({ version: 1, sourceSha256, sourceStartSec: 0,
        durationSec: choice.durationSec, ...config.resolution, fps: config.fps }));
      const controller = new AbortController();
      let oversized = false, checking = false;
      const monitor = setInterval(() => {
        if (checking) return;
        checking = true;
        void lstat(candidate).then((info) => {
          if (info.isFile() && info.size > MAX_INTRO_BYTES) { oversized = true; controller.abort(); }
        }).catch(() => {}).finally(() => { checking = false; });
      }, 100);
      monitor.unref();
      try {
        await runCommand("optional intro renderer", choice.renderer, {
          source: sourceCopy, out: candidate, receipt: receiptPath, request,
          duration: String(choice.durationSec), width: String(config.resolution.width),
          height: String(config.resolution.height), fps: String(config.fps),
        }, remainingSec(), { gracefulKillMs: 5000, env: optionalToolEnv(), signal: controller.signal });
      } catch (error) {
        if (oversized) throw new PreparationLimitError("asset_too_large");
        throw error;
      } finally { clearInterval(monitor); await assertSourceIdentity(sourceCopy, sourceSha256, deadline); }
    } else {
      candidate = resolve(config.configDir ?? process.cwd(), choice.asset!);
      receiptPath = resolve(config.configDir ?? process.cwd(), choice.receipt ?? `${choice.asset}.json`);
    }
    await snapshot(candidate, path, MAX_INTRO_BYTES, deadline);
    const receiptCopy = join(inputRoot, "receipt.json");
    await snapshot(receiptPath, receiptCopy, 16384, deadline);
    const receipt = receiptSchema.parse(JSON.parse(await readFile(receiptCopy, "utf8")));
    const hash = await hashWithBudget(path, deadline);
    const probeLog = join(await mkdtemp(join(inputRoot, "probe-")), "metrics.json");
    await runCommand("optional intro probe", ["ffprobe", "-v", "error", "-show_entries",
      "stream=codec_type,width,height,r_frame_rate,avg_frame_rate,sample_aspect_ratio,duration:stream_tags=rotate:stream_side_data=rotation:format=duration",
      "-of", "json", "{video}"], { video: path }, remainingSec(),
    { gracefulKillMs: 5000, env: optionalToolEnv(), logPath: probeLog, maxOutputBytes: MAX_PROBE_OUTPUT_BYTES });
    const probe = parseDeliverableProbe(JSON.parse(await readFile(probeLog, "utf8")));
    const rates = [frameRateValue(probe.frameRate), frameRateValue(probe.avgFrameRate), receipt.fps];
    if (receipt.sourceSha256 !== sourceSha256 || receipt.assetSha256 !== hash ||
        receipt.durationSec !== choice.durationSec || receipt.width !== config.resolution.width ||
        receipt.height !== config.resolution.height ||
        probe.width !== config.resolution.width || probe.height !== config.resolution.height ||
        probe.sampleAspectRatio !== "1:1" || probe.rotationDeg !== 0 ||
        probe.videoStreams !== 1 || probe.audioStreams !== 0 ||
        rates.some((rate) => rate === null || !Number.isFinite(rate) || Math.abs(rate - config.fps) > FRAME_RATE_EPSILON) ||
        probe.videoDurationSec === null || Math.abs(probe.videoDurationSec - choice.durationSec) > 0.5 / config.fps) {
      throw new Error("intro candidate or receipt does not match source, interval, canvas or frame rate");
    }
    await runCommand("optional intro decode", ["ffmpeg", "-v", "error", "-xerror", "-i", "{video}", "-map", "0:v:0", "-f", "null", "-"],
      { video: path }, remainingSec(), { gracefulKillMs: 5000, env: optionalToolEnv() });
    const asset: IntroAsset = { path, inputRoot, sha256: hash, sourceSha256,
      byteLength: (await stat(path)).size, durationSec: choice.durationSec, recipeId: receipt.recipeId };
    await chmod(path, 0o400);
    const { path: _path, inputRoot: _root, ...identity } = asset;
    prepared = { asset, record: { requested: true, used: true, renderer, sourceSha256, asset: identity } };
  } catch (error) {
    if (error instanceof SourceIntegrityError) throw error;
    const msg = (error as Error).message;
    const reason = error instanceof PreparationLimitError ? error.reason : msg.includes("timed out") ? "renderer_timeout" :
      msg.includes("program not found") ? "renderer_unavailable" : "invalid_candidate";
    prepared = { record: { ...skipped(reason, sourceSha256).record, renderer } };
  }
  try { await assertSourceIdentity(source, sourceSha256, deadline); }
  catch (error) {
    if (!(error instanceof PreparationLimitError)) throw error;
    prepared = { record: { ...skipped(error.reason, sourceSha256).record, renderer } };
  }
  return persist(prepared);
}

/** Optional scene/check tools inherit executable discovery, never provider credentials. */
export function optionalToolEnv(): Record<string, string> {
  return Object.fromEntries(["PATH", "LANG", "LC_ALL", "TMPDIR", "SYSTEMROOT"].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
}

async function openVerifiedIntro(asset: IntroAsset): Promise<FileHandle> {
  await containedIntroPath(asset.inputRoot, asset.path);
  const handle = await open(asset.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== asset.byteLength) throw new Error("optional intro staged input integrity failure");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
      if (offset > asset.byteLength) throw new Error("optional intro staged input integrity failure");
    }
    if (offset !== asset.byteLength || hash.digest("hex") !== asset.sha256) throw new Error("optional intro staged input integrity failure");
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

/** Consumers read the verified inode, never reopen its mutable staged name. */
export async function withVerifiedIntro<T>(asset: IntroAsset, consume: (input: Readable) => Promise<T>): Promise<T> {
  const handle = await openVerifiedIntro(asset);
  const source = handle.createReadStream({ start: 0, autoClose: false });
  const hash = createHash("sha256");
  let bytes = 0;
  const input = Readable.from((async function* () {
    for await (const chunk of source) {
      bytes += chunk.length;
      if (bytes > asset.byteLength) throw new Error("optional intro streamed input integrity failure");
      hash.update(chunk);
      yield chunk;
    }
  })(), { objectMode: false });
  try {
    const result = await consume(input);
    // A decoder may finish before container padding. Drain that suffix through
    // the same verifier, without reopening the name or discarding prefix hashes.
    for await (const _ of input) { /* finish the verified stream */ }
    if (bytes !== asset.byteLength || hash.digest("hex") !== asset.sha256) {
      throw new Error("optional intro streamed input integrity failure");
    }
    return result;
  } finally { input.destroy(); source.destroy(); await handle.close(); }
}

/** A changed or symbolic local name cannot ship unchecked bytes to a host. */
export async function stageIntroAsset(asset: IntroAsset, path: string, inputRoot: string): Promise<void> {
  await snapshot(asset.path, path);
  const handle = await openVerifiedIntro({ ...asset, path, inputRoot });
  await handle.close();
}

/** Fatal integrity check at each consumer, including after remote transport. */
export async function verifyIntro(intro: PreparedIntro | undefined, source: string): Promise<void> {
  if (!intro) return;
  if (intro.record.used !== Boolean(intro.asset)) throw new Error("optional intro state does not match staged asset");
  if (intro.record.sourceSha256) await assertSourceIdentity(source, intro.record.sourceSha256);
  if (!intro.asset) return;
  const a = intro.asset;
  const handle = await openVerifiedIntro(a);
  await handle.close();
  await assertSourceIdentity(source, a.sourceSha256);
  const { path: _path, inputRoot: _root, ...identity } = a;
  if (!intro.record.asset || Object.entries(identity).some(([k, v]) => intro.record.asset![k as keyof typeof identity] !== v)) {
    throw new Error("optional intro receipt identity mismatch");
  }
}
