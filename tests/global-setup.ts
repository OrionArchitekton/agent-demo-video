import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function setup(): void {
  // Build before workers start; per-file --clean builds race bundle readers.
  execFileSync("pnpm", ["build:remote-entry"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "inherit",
  });
}
