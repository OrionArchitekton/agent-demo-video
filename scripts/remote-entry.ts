/**
 * Remote render entrypoint. Bundled (tsup) into one self-contained file so it
 * runs on a render host that has `node` + `ffmpeg` but not this repo or pnpm.
 *
 * Contract: run with the current working directory set to a staged work dir that
 * contains `manifest.json`, `seg/` (raw segments) and `audio/` (narration). It
 * renders `<cwd>/out/final.mp4` and prints a JSON result line to stdout.
 */
import { readFileSync } from "node:fs";
import { loadManifest } from "../src/manifest";
import { renderVideo } from "../src/render";

async function main(): Promise<void> {
  const baseDir = process.cwd();
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  const result = await renderVideo(loadManifest(manifest, baseDir));
  process.stdout.write(JSON.stringify(result) + "\n");
}

main().catch((e) => {
  console.error(String((e && e.stack) || e));
  // Set exitCode (do not process.exit) so stderr flushes before exit; the caller
  // captures this output over ssh and would otherwise lose a truncated message.
  process.exitCode = 1;
});
