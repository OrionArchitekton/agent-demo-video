#!/usr/bin/env -S npx tsx
import { loadConfig } from "./config";
import { runPipeline } from "./pipeline";
const cfgPath = process.argv[2] ?? "demo.config.json";
runPipeline(loadConfig(cfgPath))
  .then((r) => { console.log("✓ wrote", r.outPath, "(" + r.report.totalSec.toFixed(1) + "s, " + r.report.segments + " segments)"); })
  .catch((e) => { console.error("✗ pipeline failed:", e.message); process.exit(1); });
