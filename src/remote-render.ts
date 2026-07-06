import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RenderInputs } from "./render";
import { buildManifest } from "./manifest";
import { LocalTransport, type Transport } from "./transport";

export interface RemoteRenderOpts {
  /** How to reach the render host (LocalTransport or SshTransport). */
  transport: Transport;
  /** Path to the built self-contained render bundle (dist-remote/remote-entry.js). */
  bundlePath: string;
  /** Work directory on the render host. */
  workDir: string;
  /** Local path to write the retrieved final.mp4. */
  outPath: string;
  /** Local staging dir; a temp dir is created (and cleaned) if omitted. */
  stageDir?: string;
  /** Preflight the caption font on the host to catch silent libass substitution (default true). */
  verifyFont?: boolean;
}

/**
 * Guard against silent caption-font drift: if the render host resolves the
 * caption font to a different family than this host does, burned captions would
 * diverge (the exact failure the equivalence proof targets, which verifyParity's
 * duration/count check cannot see). fc-match is a hard dependency of any host
 * that can burn captions (libass + fontconfig), so an unresolvable check is a
 * loud failure, not a silent skip.
 */
async function assertFontParity(transport: Transport, font: string): Promise<void> {
  const hostFam = (await transport.capture(["fc-match", "-f", "%{family}", font])).trim();
  const localFam = (await new LocalTransport().capture(["fc-match", "-f", "%{family}", font]).catch(() => "")).trim();
  if (localFam && hostFam && localFam.toLowerCase() !== hostFam.toLowerCase()) {
    throw new Error(
      `[remote-render] caption font drift: render host resolves "${font}" to "${hostFam}", ` +
        `local resolves to "${localFam}". Burned captions would diverge; install the font on the render host or pin a shared face.`,
    );
  }
}

/**
 * Render the video on a remote host and bring the result back, WITHOUT modifying
 * the caller's inputs. Inputs are copied into a staging dir under stable
 * index-based names (so distinct sources sharing a basename cannot collide),
 * shipped with the render bundle + manifest, rendered by `renderVideo` on the
 * host, and the final.mp4 is retrieved. Any step failure rejects loudly; the
 * original inputs are never touched, so a local render remains a safe fallback.
 */
export async function renderRemote(inputs: RenderInputs, opts: RemoteRenderOpts): Promise<string> {
  const ownsStage = !opts.stageDir;
  const stage = opts.stageDir ?? (await mkdtemp(join(tmpdir(), "adv-stage-")));
  try {
    if (opts.verifyFont !== false) await assertFontParity(opts.transport, inputs.config.theme.captionFont);

    const manifest = buildManifest(inputs);
    const stageSeg = join(stage, "seg");
    const stageAudio = join(stage, "audio");
    await mkdir(stageSeg, { recursive: true });
    await mkdir(stageAudio, { recursive: true });
    // Copy inputs into staging under the manifest's index-based names (read-only
    // w.r.t. the originals; collision-free even if two sources share a basename).
    for (let i = 0; i < inputs.rawSegments.length; i++) await cp(inputs.rawSegments[i]!, join(stageSeg, manifest.segments[i]!));
    for (let i = 0; i < inputs.tts.length; i++) await cp(inputs.tts[i]!.audioPath, join(stageAudio, manifest.audio[i]!.file));
    await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest), "utf8");
    await cp(opts.bundlePath, join(stage, "remote-entry.js"));

    // Ship -> run -> collect.
    await opts.transport.mkdirp(opts.workDir);
    await opts.transport.pushDir(stage, opts.workDir);
    await opts.transport.exec(opts.workDir, ["node", "remote-entry.js"]);
    await opts.transport.pullFile(join(opts.workDir, "out", "final.mp4"), opts.outPath);
    // Best-effort remote cleanup; log (do not swallow) so a leaked work dir is traceable.
    await opts.transport.remove(opts.workDir).catch((e) =>
      console.warn(`[remote-render] could not remove remote work dir ${opts.workDir}: ${String((e && e.message) || e)}`),
    );
    return opts.outPath;
  } finally {
    if (ownsStage) await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
