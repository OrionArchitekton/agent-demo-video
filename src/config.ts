import { readFileSync } from "node:fs";
import { ZodError } from "zod";
import { DemoConfigSchema } from "./types";
import type { DemoConfig } from "./types";
import { resolveProfileDir } from "./profile";

export function loadConfig(path: string): DemoConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  try {
    const cfg = DemoConfigSchema.parse(parsed);
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
