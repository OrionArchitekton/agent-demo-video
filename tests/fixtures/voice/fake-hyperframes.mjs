// stand-in hyperframes CLI: writes a file to the -o path, then exits 0 with a hard error in its log
import { writeFileSync } from "node:fs";
const out = process.argv[process.argv.indexOf("-o") + 1];
if (out) writeFileSync(out, "xxxx");
console.log("rendering...");
console.error("PAGEERROR boom");
process.exit(0);
