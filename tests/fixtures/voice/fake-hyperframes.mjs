// stand-in hyperframes CLI: writes a file to the -o path, then exits 0 with a hard error in its log.
// It also records the opt-out variables and DISPLAY it was started with in <out>.env.json.
import { writeFileSync } from "node:fs";
const out = process.argv[process.argv.indexOf("-o") + 1];
if (out) {
  const keys = ["HYPERFRAMES_NO_TELEMETRY", "HYPERFRAMES_NO_UPDATE_CHECK", "HYPERFRAMES_NO_AUTO_INSTALL", "DO_NOT_TRACK", "DISPLAY"];
  writeFileSync(`${out}.env.json`, JSON.stringify(Object.fromEntries(keys.map((k) => [k, process.env[k] ?? null]))));
  writeFileSync(out, "xxxx");
}
console.log("rendering...");
console.error("PAGEERROR boom");
process.exit(0);
