/**
 * sanitize.ts — making untrusted text safe to PRINT.
 *
 * Pure module: no imports. Two hazards, both from text this pipeline does not
 * author: pages it navigates, and URLs an operator declares.
 */

/**
 * Strip control characters from text that originated in a page we may not own.
 *
 * A page controls its own error strings, and an ANSI escape inside one can
 * forge a clean-looking log line in the operator's terminal. `ready.ts` already
 * does this for its probe errors; anything else that interpolates page-derived
 * text into a printed message needs the same treatment.
 */
export function scrubControlChars(raw: string, max = 200): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .slice(0, max);
}

/**
 * Drop credential-bearing parts of a URL before it is logged.
 *
 * A `dashboardBaseUrl` legitimately carries a bypass token in its query string
 * (a Vercel protection bypass, a signed preview link) or userinfo in
 * `https://user:pass@host/`. Pre-flight findings name the URL a selector was
 * resolved against, and those findings are exactly what an operator pastes into
 * a public issue, so the secret must never reach the message.
 */
export function redactUrl(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.search = "";
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    return parsed.href;
  } catch {
    // Not parseable as a URL: keep everything before the first query separator.
    return (u ?? "").split(/[?#]/)[0] ?? "";
  }
}
