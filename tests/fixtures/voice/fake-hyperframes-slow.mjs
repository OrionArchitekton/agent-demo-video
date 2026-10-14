// stand-in hyperframes CLI that never finishes; on SIGTERM it writes <out>.term and exits.
import { writeFileSync } from "node:fs";
const out = process.argv[process.argv.indexOf("-o") + 1];
process.on("SIGTERM", () => {
  if (out) writeFileSync(`${out}.term`, "term");
  process.exit(0);
});
setInterval(() => {}, 1000);
