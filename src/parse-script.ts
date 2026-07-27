import { ManifestSchema, type Manifest, type Shot, type Action } from "./types";

function parseAction(rest: string): Action {
  const kind = rest.trim().split(/\s+/)[0] as Action["kind"];
  const attrs: Record<string, string> = {};
  for (const m of rest.matchAll(/(\w+)="([^"]*)"/g)) attrs[m[1]!] = m[2]!;
  const msMatch = rest.match(/\bms=(\d+)/);
  const yMatch = rest.match(/\by=(\d+)/);
  return {
    kind,
    ...(attrs.selector ? { selector: attrs.selector } : {}),
    ...(attrs.text ? { text: attrs.text } : {}),
    ...(attrs.url ? { url: attrs.url } : {}),
    ...(attrs.label ? { label: attrs.label } : {}),
    ...(msMatch ? { ms: Number(msMatch[1]) } : {}),
    ...(yMatch ? { y: Number(yMatch[1]) } : {}),
  };
}

const TRUTHY = new Set(["true", "yes", "1"]);
const FALSY = new Set(["false", "no", "0"]);

export function parseScript(md: string): Manifest {
  const shots: Shot[] = [];
  let cur: (Partial<Shot> & { actions: Action[] }) | null = null;
  const push = () => {
    if (cur && cur.id) {
      shots.push({
        id: cur.id,
        target: cur.target ?? "dashboard",
        narration: cur.narration ?? "",
        actions: cur.actions,
        ...(cur.url ? { url: cur.url } : {}),
        ...(cur.clip ? { clip: cur.clip } : {}),
        ...(cur.fullBleed ? { fullBleed: true } : {}),
      } as Shot);
    }
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const h = line.match(/^###\s+SHOT\s+(\S+)/);
    if (h) { push(); cur = { id: h[1]!, actions: [] }; continue; }
    if (!cur) continue;
    const kv = line.match(/^-\s+(target|url|clip|narration):\s*(.*)$/);
    if (kv) { (cur as Record<string, unknown>)[kv[1]!] = kv[2]!.trim(); continue; }
    // Match the KEY loosely and validate the VALUE strictly, so an unrecognised
    // spelling is refused rather than silently dropped. A dropped line would mean
    // the author believes they opted out of framing while the pipeline frames
    // anyway: the same silent-misconfiguration class the strict config schema
    // exists to close.
    const fb = line.match(/^-\s*fullbleed\s*:\s*(.*)$/i);
    if (fb) {
      const v = (fb[1] ?? "").trim().toLowerCase();
      if (TRUTHY.has(v)) { (cur as Record<string, unknown>).fullBleed = true; continue; }
      if (FALSY.has(v)) { (cur as Record<string, unknown>).fullBleed = false; continue; }
      throw new Error(
        `shot ${cur.id ?? "(unnamed)"}: fullBleed expects true or false, got "${(fb[1] ?? "").trim()}". ` +
          "Accepted: true/false, yes/no, 1/0.",
      );
    }
    const act = line.match(/^-\s+action:\s*(.*)$/);
    if (act) { cur.actions.push(parseAction(act[1]!)); continue; }
  }
  push();
  return ManifestSchema.parse({ shots });
}

/**
 * Per-segment render treatment.
 *
 * "card" means the segment is already a final composition, so renderVideo skips
 * both the window framing and the segment fade-in. The pipeline's own brand
 * cards use this; a fullBleed shot is the author-declared form of the same fact.
 */
export function deriveSegmentKinds(shots: Shot[]): ("shot" | "card")[] {
  return shots.map((s) => (s.fullBleed ? "card" : "shot"));
}
