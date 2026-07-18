import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ZodError } from "zod";
import { DemoConfigSchema } from "./types";
import type { DemoConfig } from "./types";
import { resolveProfileDir } from "./profile";

export function loadConfig(path: string): DemoConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  try {
    const cfg = DemoConfigSchema.parse(parsed);
    // A "./"-relative base resolves against the config file's directory into a
    // file:// URL, so a hermetic fixture demo runs identically from any cwd.
    if (cfg.dashboardBaseUrl.startsWith("./") || cfg.dashboardBaseUrl === ".") {
      // pathToFileURL percent-encodes URL-significant characters (spaces, #)
      // that a naive string concat would pass through broken.
      cfg.dashboardBaseUrl = pathToFileURL(resolve(join(dirname(resolve(path)), cfg.dashboardBaseUrl))).href;
    }
    // Pin the auth profile to an absolute, outside-the-repo path (secrets at rest).
    if (cfg.capture.auth) {
      cfg.capture.auth.profileDir = resolveProfileDir(cfg.capture.auth.profileDir, cfg.capture.auth.loginUrl);
    }
    return cfg;
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(`Invalid config ${path}: ${err.message}`);
    }
    throw err;
  }
}
