/**
 * Environment for HEADLESS browsers: everything except the desktop display variables.
 * A headless browser never needs a display, but Chromium still reads DISPLAY/WAYLAND_DISPLAY;
 * when that display is set but dead (common on WSL after the display server crashes) every
 * capture stalls ~30 s and fails on an unrelated locator. specs/render-quality-checks-spec.md S2.
 */
const DISPLAY_VARS = new Set(["DISPLAY", "WAYLAND_DISPLAY"]);

export function headlessBrowserEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && !DISPLAY_VARS.has(k)) out[k] = v;
  }
  return out;
}
