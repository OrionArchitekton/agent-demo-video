import { isAbsolute, resolve } from "node:path";

/**
 * clips.ts — where a prebaked shot's `clip:` path actually points.
 *
 * Before this existed, `captureShot` returned `shot.clip` verbatim, so clip
 * paths resolved against the PROCESS CWD: the same config found different files
 * depending on which directory the pipeline was invoked from, and `clipsDir`
 * was declared, defaulted, documented, and read by nothing.
 *
 * The rule, in order:
 *   - an absolute clip path is used exactly as given;
 *   - a BARE filename is joined into `clipsDir` (what the README's "place the
 *     clip in clipsDir" has always promised);
 *   - anything else already carries its own directory, and resolves against the
 *     config file's directory.
 *
 * The bare-filename split is what keeps this backward compatible: joining
 * `clipsDir` onto EVERY relative path would double it onto the README's own
 * `clip: clips/prebaked/uipath-studio.mp4` example.
 *
 * `clipsDir` itself resolves against the config file's directory unless it is
 * absolute — the same treatment `dashboardBaseUrl` already gets in loadConfig.
 */
export function resolveClipPath(clip: string, clipsDir: string, configDir: string): string {
  if (isAbsolute(clip)) return clip;
  // "Bare" means literally no path separator. `dirname(clip) === "."` would
  // also call "./x.mp4" bare and quietly send it to clipsDir, contradicting the
  // documented rule that a path carrying a directory resolves against the
  // config file's directory.
  if (!/[\\/]/.test(clip)) return resolve(configDir, clipsDir, clip);
  return resolve(configDir, clip);
}
