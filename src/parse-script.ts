import { ManifestSchema, type Manifest, type Shot, type Action } from "./types";

function parseAction(rest: string): Action {
  const kind = rest.trim().split(/\s+/)[0] as Action["kind"];
  const attrs: Record<string, string> = {};
  for (const m of rest.matchAll(/(\w+)="([^"]*)"/g)) attrs[m[1]!] = m[2]!;
  const msMatch = rest.match(/\bms=(\d+)/);
  return {
    kind,
    ...(attrs.selector ? { selector: attrs.selector } : {}),
    ...(attrs.text ? { text: attrs.text } : {}),
    ...(attrs.url ? { url: attrs.url } : {}),
    ...(attrs.label ? { label: attrs.label } : {}),
    ...(msMatch ? { ms: Number(msMatch[1]) } : {}),
  };
}

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
    const act = line.match(/^-\s+action:\s*(.*)$/);
    if (act) { cur.actions.push(parseAction(act[1]!)); continue; }
  }
  push();
  return ManifestSchema.parse({ shots });
}
