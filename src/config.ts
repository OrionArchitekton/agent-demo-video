import { readFileSync } from "node:fs";
import { ZodError } from "zod";
import { DemoConfigSchema } from "./types";
import type { DemoConfig } from "./types";

export function loadConfig(path: string): DemoConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  try {
    return DemoConfigSchema.parse(parsed);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(`Invalid config ${path}: ${err.message}`);
    }
    throw err;
  }
}
