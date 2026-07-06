import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { RenderInputs } from "./render";
import { buildManifest } from "./manifest";
import type { Transport } from "./transport";

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
}

/**
 * Render the video on a remote host and bring the result back, WITHOUT modifying
 * the caller's inputs. Inputs are copied into a staging dir, shipped with the
 * render bundle + manifest, rendered by `renderVideo` on the host, and the
 * final.mp4 is retrieved. Any step failure rejects loudly; the original inputs
 * are never touched, so a local render remains a safe fallback.
 */
export async function renderRemote(inputs: RenderInputs, opts: RemoteRenderOpts): Promise<string> {
  const ownsStage = !opts.stageDir;
  const stage = opts.stageDir ?? (await mkdtemp(join(tmpdir(), "adv-stage-")));
  try {
    const stageSeg = join(stage, "seg");
    const stageAudio = join(stage, "audio");
    await mkdir(stageSeg, { recursive: true });
    await mkdir(stageAudio, { recursive: true });
    // Copy inputs into staging (read-only w.r.t. the originals).
    for (const seg of inputs.rawSegments) await cp(seg, join(stageSeg, basename(seg)));
    for (const t of inputs.tts) await cp(t.audioPath, join(stageAudio, basename(t.audioPath)));
    await writeFile(join(stage, "manifest.json"), JSON.stringify(buildManifest(inputs)), "utf8");
    await cp(opts.bundlePath, join(stage, "remote-entry.js"));

    // Ship -> run -> collect.
    await opts.transport.mkdirp(opts.workDir);
    await opts.transport.pushDir(stage, opts.workDir);
    await opts.transport.exec(opts.workDir, ["node", "remote-entry.js"]);
    await opts.transport.pullFile(join(opts.workDir, "out", "final.mp4"), opts.outPath);
    await opts.transport.remove(opts.workDir).catch(() => {}); // best-effort cleanup
    return opts.outPath;
  } finally {
    if (ownsStage) await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
