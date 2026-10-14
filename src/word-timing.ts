import type { Alignment } from "./types";

/** One timed word from a voice command or an aligner, seconds relative to the shot's audio. */
export interface TimedWord { word: string; start: number; end: number; }

/** Below this share of script words matched, the take is treated as wrong or truncated. */
export const MIN_COVERAGE = 0.6;

/** Upper bound on the alignment table, (script words + 1) * (timed words + 1); ~16 MB of Int32. */
const MAX_ALIGN_CELLS = 4_000_000;

const key = (w: string) => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const MAX_JOIN = 4;
const MIN_STEP = 0.05;
const MIN_WIDTH = 0.01;

/** How one run of script tokens was matched: `merged` tokens from `token` on cover timed words j..j+len-1. */
export interface MatchLink { token: number; j: number; len: number; merged: number; }

/**
 * Ordered, spelling-insensitive match of the script's words against timed (or heard) words.
 * `matched[i]` says whether script token i found its place; `links` records how, for timing.
 * When several alignments match equally many words, `preferSkip` leaves a script word unmatched
 * rather than letting it steal a later sentence's heard words (right for omission checks).
 */
export function matchScriptTokens(text: string, timed: { word: string }[], opts: { preferSkip?: boolean } = {}): { tokens: { word: string; index: number }[]; matched: boolean[]; links: MatchLink[] } {
  const tokens = [...text.matchAll(/\S+/g)].map((m) => ({ word: m[0], index: m.index! }));
  const matched: boolean[] = tokens.map(() => false);
  const links: MatchLink[] = [];

  // Sequence alignment: maximize matched script tokens. The match is symmetric: one script
  // token may consume 1..MAX_JOIN joined timed words ("state-of-the-art" vs state,of,the,art),
  // and one timed word may cover 2..MAX_JOIN joined script tokens ("Set up" vs "Setup").
  const cand = tokens.map((t, i) => ({ i, k: key(t.word) })).filter((c) => c.k);
  const tkeys = timed.map((t) => key(t.word));
  const n = cand.length, m = timed.length, W = m + 1;
  if ((n + 1) * (m + 1) > MAX_ALIGN_CELLS) {
    throw new Error(`word timings are too large to align (${n} script words x ${m} timed words, max ${MAX_ALIGN_CELLS} table cells)`);
  }
  const joinLen = (ci: number, j: number): number => {
    let acc = "";
    for (let len = 1; len <= MAX_JOIN && j + len <= m; len++) {
      acc += tkeys[j + len - 1];
      if (acc.length > cand[ci]!.k.length) return 0;
      if (acc === cand[ci]!.k) return len;
    }
    return 0;
  };
  const mergeLen = (ci: number, j: number): number => {
    const target = tkeys[j]!;
    let acc = cand[ci]!.k;
    for (let len = 2; len <= MAX_JOIN && ci + len <= n; len++) {
      acc += cand[ci + len - 1]!.k;
      if (acc.length > target.length) return 0;
      if (acc === target) return len;
    }
    return 0;
  };
  const dp = new Int32Array((n + 1) * W);
  for (let ci = n - 1; ci >= 0; ci--) {
    for (let j = m; j >= 0; j--) {
      let best = dp[(ci + 1) * W + j]!;
      if (j < m) {
        best = Math.max(best, dp[ci * W + j + 1]!);
        const len = joinLen(ci, j);
        if (len) best = Math.max(best, 1 + dp[(ci + 1) * W + j + len]!);
        const merged = mergeLen(ci, j);
        if (merged) best = Math.max(best, merged + dp[(ci + merged) * W + j + 1]!);
      }
      dp[ci * W + j] = best;
    }
  }
  let ci = 0, j = 0;
  while (ci < n && j < m) {
    const here = dp[ci * W + j]!;
    if (opts.preferSkip && dp[(ci + 1) * W + j]! === here) { ci++; continue; }
    const len = joinLen(ci, j);
    const merged = mergeLen(ci, j);
    if (len && 1 + dp[(ci + 1) * W + j + len]! === here) {
      matched[cand[ci]!.i] = true;
      links.push({ token: cand[ci]!.i, j, len, merged: 1 });
      ci++; j += len;
    } else if (merged && merged + dp[(ci + merged) * W + j + 1]! === here) {
      // The merged script tokens share the timed word's span, split by character share.
      for (let q = 0; q < merged; q++) matched[cand[ci + q]!.i] = true;
      links.push({ token: cand[ci]!.i, j, len: 1, merged });
      ci += merged; j++;
    } else if (dp[(ci + 1) * W + j]! === here) ci++;
    else j++;
  }
  return { tokens, matched, links };
}

/**
 * Map timed words onto the script's OWN words (captions never show recognizer spelling),
 * interpolate words the timings missed between their neighbours, and expand to the
 * per-character alignment the caption builder consumes.
 */
export function alignScriptWords(text: string, timed: TimedWord[], durationSec: number): { alignment: Alignment; coverage: number } {
  const { tokens, links } = matchScriptTokens(text, timed);
  const times: ({ start: number; end: number } | null)[] = tokens.map(() => null);
  const n = tokens.filter((t) => key(t.word)).length;
  for (const l of links) {
    if (l.merged === 1) {
      times[l.token] = { start: timed[l.j]!.start, end: timed[l.j + l.len - 1]!.end };
      continue;
    }
    // Merged script tokens (countable ones) share the timed word's span, split by character share.
    const { start, end } = timed[l.j]!;
    const total = key(timed[l.j]!.word).length;
    const idx: number[] = [];
    for (let q = l.token; idx.length < l.merged; q++) if (key(tokens[q]!.word)) idx.push(q);
    let used = 0;
    for (const q of idx) {
      const share = key(tokens[q]!.word).length;
      times[q] = { start: start + ((end - start) * used) / total, end: start + ((end - start) * (used + share)) / total };
      used += share;
    }
  }
  const coverage = times.filter(Boolean).length / (n || 1);

  // Interpolate each run of unknown tokens evenly between the known neighbours.
  let i = 0;
  while (i < tokens.length) {
    if (times[i]) { i++; continue; }
    let k = i;
    while (k < tokens.length && !times[k]) k++;
    const from = i > 0 ? times[i - 1]!.end : 0;
    const to = k < tokens.length ? times[k]!.start : durationSec;
    const step = Math.max((to - from) / (k - i), MIN_STEP);
    for (let n = i; n < k; n++) times[n] = { start: from + step * (n - i), end: from + step * (n - i + 1) };
    i = k;
  }

  // Forward clamp: times never go backwards and every word has positive width.
  let prevEnd = 0;
  for (const t of times) {
    t!.start = Math.max(t!.start, prevEnd);
    t!.end = Math.max(t!.end, t!.start + MIN_WIDTH);
    prevEnd = t!.end;
  }
  // Words the take never reached collapse onto the audio end instead of running past it.
  for (const t of times) {
    t!.start = Math.min(t!.start, durationSec);
    t!.end = Math.min(t!.end, durationSec);
  }

  // UTF-16 units, so indices from matchAll line up with the arrays (astral chars stay two units).
  const chars = text.split("");
  const startSec: number[] = new Array(chars.length);
  const endSec: number[] = new Array(chars.length);
  const r = (x: number) => +x.toFixed(6);
  let cursor = 0;
  tokens.forEach((t, ti) => {
    const { start, end } = times[ti]!;
    for (let c = cursor; c < t.index; c++) { startSec[c] = r(start); endSec[c] = r(start); } // whitespace before the word
    const n = t.word.length;
    for (let c = 0; c < n; c++) {
      startSec[t.index + c] = r(start + ((end - start) * c) / n);
      endSec[t.index + c] = r(start + ((end - start) * (c + 1)) / n);
    }
    cursor = t.index + n;
  });
  const last = tokens.length ? times[tokens.length - 1]!.end : 0;
  for (let c = cursor; c < chars.length; c++) { startSec[c] = r(last); endSec[c] = r(last); }
  return { alignment: { chars, startSec, endSec }, coverage };
}
