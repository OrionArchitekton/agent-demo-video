/**
 * contact-sheet.ts - one still per shot, tiled beside the deliverable
 * (specs/deliverable-verification-spec.md).
 *
 * The plan is pure: beats come from the MEASURED timeline, each clamped to a
 * frame inside its own shot. The build extracts stills from the delivered file
 * and verifies the written sheet's geometry, so a sheet that could not be made
 * fails the run instead of being reported.
 */
import { mkdir, open, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg } from "./ffmpeg";

/** Tile width in pixels; tile height follows the deliverable's aspect ratio. */
export const TILE_WIDTH = 480;
const GAP = 8;
const LANDSCAPE_COLUMNS = 4;
const PORTRAIT_COLUMNS = 6;
const BACKGROUND = "0x111111";
const STILLS_DIR = "contact-sheet";
const SHEET_FILE = "contact-sheet.png";

export type ContactSheetStill = { shotId: string; atSec: number; path: string };

export type ContactSheetPlan = {
  path: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
  tile: { width: number; height: number };
  stills: ContactSheetStill[];
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's IHDR chunk. Read directly rather than via
 *  ffprobe, whose image2 demuxer would expand `%` sequences in the path. */
export async function pngSizePx(path: string): Promise<{ width: number; height: number }> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, 24, 0);
    if (bytesRead < 24 || !header.subarray(0, 8).equals(PNG_SIGNATURE) || header.toString("latin1", 12, 16) !== "IHDR") {
      throw new Error(`[agent-demo-video] contact sheet is not a PNG: ${path}`);
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Midpoint beat, clamped so the still lands on a frame inside its own shot. */
export function beatSec(entry: { startSec: number; durationSec: number }, fps: number): number {
  const lastFrame = entry.startSec + Math.max(0, entry.durationSec - 1 / fps);
  const mid = entry.startSec + entry.durationSec / 2;
  return round6(Math.max(entry.startSec, Math.min(mid, lastFrame)));
}

export function planContactSheet(
  entries: { shotId: string; startSec: number; durationSec: number }[],
  fps: number,
  resolution: { width: number; height: number },
): ContactSheetPlan {
  if (entries.length === 0) throw new Error("contact sheet needs at least one timeline entry");
  const tileHeight = 2 * Math.round((TILE_WIDTH * resolution.height) / resolution.width / 2);
  const maxColumns = resolution.width >= resolution.height ? LANDSCAPE_COLUMNS : PORTRAIT_COLUMNS;
  const columns = Math.min(entries.length, maxColumns);
  const rows = Math.ceil(entries.length / columns);
  return {
    path: SHEET_FILE,
    width: 2 * GAP + columns * TILE_WIDTH + (columns - 1) * GAP,
    height: 2 * GAP + rows * tileHeight + (rows - 1) * GAP,
    columns,
    rows,
    tile: { width: TILE_WIDTH, height: tileHeight },
    stills: entries.map((e, i) => ({
      shotId: e.shotId,
      atSec: beatSec(e, fps),
      // Index-named: shot ids are operator text and never reach a path or filter.
      path: `${STILLS_DIR}/still_${String(i).padStart(3, "0")}.png`,
    })),
  };
}

/**
 * Extract, tile, and verify. Rejects when a still yields no frame or the written
 * sheet is not the planned geometry.
 *
 * Every file name reaches ffmpeg as a literal (`-update 1` on image outputs,
 * `-pattern_type none` on image inputs): the image2 muxer and demuxer otherwise
 * expand `%` sequences, so an out dir containing `%d` would be rewritten.
 */
export async function buildContactSheet(
  video: string,
  outDir: string,
  plan: ContactSheetPlan,
): Promise<ContactSheetPlan> {
  const stillsDir = join(outDir, STILLS_DIR);
  const sheetPath = join(outDir, plan.path);
  // A reused out dir may hold an earlier render's sheet and more stills than this
  // plan has; start from nothing so no stale image can be tiled or reported.
  await rm(stillsDir, { recursive: true, force: true });
  await rm(sheetPath, { force: true });
  await mkdir(stillsDir, { recursive: true });

  // The even tile height is not always an exact aspect ratio (a 1080x1920 frame
  // at 480 wide is 853.33 tall), and ffmpeg then compensates with a non-square
  // sample aspect ratio that the tiled sheet inherits. Pin square pixels: the
  // sub-pixel stretch is invisible in a review image.
  const scale = `scale=${plan.tile.width}:${plan.tile.height},setsar=1`;
  for (const still of plan.stills) {
    const stillPath = join(outDir, still.path);
    await ffmpeg([
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", String(still.atSec), "-i", video,
      "-frames:v", "1", "-vf", scale, "-update", "1",
      stillPath,
    ]);
    // ffmpeg exits 0 without writing when the seek lands past the video stream.
    const size = await stat(stillPath).then((s) => s.size, () => 0);
    if (size === 0) {
      throw new Error(
        `[agent-demo-video] contact sheet still for shot ${still.shotId} at ${still.atSec}s is missing: the video yielded no frame there`,
      );
    }
  }

  const inputs = plan.stills.flatMap((s) => ["-f", "image2", "-pattern_type", "none", "-i", join(outDir, s.path)]);
  const joined = plan.stills.map((_, i) => `[${i}:v]`).join("");
  await ffmpeg([
    "-y", "-hide_banner", "-loglevel", "error",
    ...inputs,
    "-filter_complex",
    `${joined}concat=n=${plan.stills.length}:v=1:a=0,tile=${plan.columns}x${plan.rows}:margin=${GAP}:padding=${GAP}:color=${BACKGROUND}[sheet]`,
    "-map", "[sheet]", "-frames:v", "1", "-update", "1",
    sheetPath,
  ]);
  const size = await pngSizePx(sheetPath);
  if (size.width !== plan.width || size.height !== plan.height) {
    throw new Error(
      `[agent-demo-video] contact sheet geometry ${size.width}x${size.height} does not match the planned ${plan.width}x${plan.height}`,
    );
  }
  return plan;
}
