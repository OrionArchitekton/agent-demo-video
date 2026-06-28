import { z } from "zod";

export const ActionSchema = z.object({
  kind: z.enum(["goto", "click", "type", "wait", "hover", "highlight", "chapter"]),
  selector: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  ms: z.number().optional(),
  label: z.string().optional(),
});
export type Action = z.infer<typeof ActionSchema>;

export const ShotSchema = z.object({
  id: z.string(),
  // "live" drives an authenticated SaaS app via a saved Playwright persistent-context
  // profile (see capture.auth). Manifest syntax is identical to "dashboard".
  target: z.enum(["dashboard", "uipath", "terminal", "prebaked", "live"]),
  narration: z.string(),
  actions: z.array(ActionSchema).default([]),
  url: z.string().optional(),
  clip: z.string().optional(),
});
export type Shot = z.infer<typeof ShotSchema>;

export const ManifestSchema = z.object({ shots: z.array(ShotSchema).min(1) });
export type Manifest = z.infer<typeof ManifestSchema>;

export const DemoConfigSchema = z.object({
  script: z.string(),
  dashboardBaseUrl: z.string(),
  out: z.string().default("out"),
  resolution: z.object({ width: z.number(), height: z.number() }).default({ width: 1920, height: 1080 }),
  fps: z.number().default(30),
  voice: z.object({
    voiceId: z.string().default("21m00Tcm4TlvDq8ikWAM"),
    modelId: z.string().default("eleven_flash_v2_5"),
    seed: z.number().default(42),
    stability: z.number().default(0.5),
    similarity: z.number().default(0.75),
  }).default({}),
  theme: z.object({
    captionFont: z.string().default("Arial"),
    captionSize: z.number().default(24),
    cursor: z.boolean().default(true),
    captionBox: z.boolean().default(true),
    captionMarginV: z.number().default(20),
  }).default({}),
  clipsDir: z.string().default("clips/prebaked"),
  // Auth-walled SaaS live capture (target: "live"). The whole section is optional so
  // existing dashboard/prebaked configs validate unchanged. `auth` is only required
  // when a manifest contains a "live" shot. The profile holds session cookies/tokens
  // AT REST, so profileDir is resolved to an absolute, outside-the-repo path in
  // loadConfig (default ~/.cache/agent-demo-video) — never committed.
  capture: z.object({
    auth: z.object({
      profileDir: z.string().optional(),
      loginUrl: z.string(),
      loggedInSelector: z.string().optional(),
      // operator: human presses Enter (authoritative). selector: wait for loggedInSelector.
      // auto: accept loggedInSelector with a settle delay. Default operator (robust for
      // apps we don't own; absorbs MFA/SSO with no special code).
      confirmMode: z.enum(["operator", "selector", "auto"]).default("operator"),
      loginTimeoutMs: z.number().default(120000),
      // Login is headed by default (a human logs in). Tests/unattended selector flows
      // can force headless.
      headlessLogin: z.boolean().default(false),
      // A live shot REQUIRES loggedInSelector so the record-time expiry guard can run
      // (fail-closed). Set this true to record without the guard, accepting that an
      // expired session would be recorded.
      allowUnguardedLiveCapture: z.boolean().default(false),
    }).optional(),
  }).default({}),
  // Optional CSS injected into every captured page before interaction. Use to
  // stabilise capture of dashboards taller than the output frame — e.g. bound a
  // growing list's height so the document never overflows the viewport (which
  // otherwise makes the browser scale the page down, producing a "breathing"
  // zoom between shots).
  captureCss: z.string().optional(),
});
export type DemoConfig = z.infer<typeof DemoConfigSchema>;

export interface Alignment { chars: string[]; startSec: number[]; endSec: number[]; }
export interface TtsResult { shotId: string; audioPath: string; durationSec: number; alignment: Alignment; }
export interface TimelineEntry { shotId: string; startSec: number; durationSec: number; }
