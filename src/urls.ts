/**
 * urls.ts — how a shot's declared url becomes the URL that shot opens.
 *
 * Pure module: no imports. Shared by the capture path and the pre-flight gate
 * so the gate can never resolve a shot to a different page than the render
 * does — a second, divergent definition of "where this shot goes" would be the
 * same class of silent disagreement the gate exists to catch.
 */
export function resolveUrl(u: string, baseUrl: string): string {
  if (u.startsWith("http") || u.startsWith("file:")) return u;
  const base = baseUrl.replace(/\/$/, "");
  return base + (u.startsWith("/") ? u : "/" + u);
}
