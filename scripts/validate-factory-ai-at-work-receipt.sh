#!/usr/bin/env bash
set -euo pipefail

case "$-" in
  *p*) ;;
  *)
    builtin printf '%s\n' \
      "Factory receipt validation requires Bash privileged startup mode (-p)" >&2
    builtin exit 2
    ;;
esac

PATH=/usr/bin:/bin
export PATH
hash -r

# Authority-sensitive Git calls must discover the repository from the explicit
# receipt base, and the validator must not consume caller startup, preload,
# Node, package-manager, or tool-search overrides.
while IFS= read -r factory_environment_name; do
  case "$factory_environment_name" in
    BASH_ENV|ENV|CDPATH|LD_PRELOAD|LD_LIBRARY_PATH|LD_AUDIT|RIPGREP_CONFIG_PATH|GIT_*|NODE_*|TSX_*|ESBUILD_BINARY_PATH|NPM_CONFIG_*|npm_config_*|PNPM_*|COREPACK_*)
      unset "$factory_environment_name"
      ;;
  esac
done < <(compgen -e)
unset factory_environment_name
GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_GLOBAL=/dev/null
GIT_ATTR_NOSYSTEM=1
export GIT_CONFIG_NOSYSTEM GIT_CONFIG_GLOBAL GIT_ATTR_NOSYSTEM

factory_require_node_binary() {
  local node_input="$1"
  local node_path
  case "$node_input" in
    /*) ;;
    *)
      echo "Node binary path must be absolute" >&2
      return 1
      ;;
  esac
  if ! node_path="$(/usr/bin/realpath -e -- "$node_input")"; then
    echo "Node binary path does not resolve: $node_input" >&2
    return 1
  fi
  if [ "$node_path" != "$node_input" ]; then
    echo "Node binary path must already be canonical: $node_input" >&2
    return 1
  fi
  if [ -L "$node_path" ] || [ ! -f "$node_path" ] || [ ! -x "$node_path" ]; then
    echo "Node binary must be a regular executable file: $node_path" >&2
    return 1
  fi
  local node_owner
  node_owner="$(/usr/bin/stat -c '%u' -- "$node_path")"
  if [ "$node_owner" -ne 0 ]; then
    echo "Node binary must be root-owned: $node_path" >&2
    return 1
  fi
  local node_permissions
  node_permissions="$(/usr/bin/stat -c '%a' -- "$node_path")"
  if (( (8#$node_permissions & 0022) != 0 )); then
    echo "Node binary must not be group- or world-writable: $node_path" >&2
    return 1
  fi
  local node_parent
  node_parent="$(/usr/bin/dirname -- "$node_path")"
  while true; do
    local node_parent_owner
    local node_parent_permissions
    node_parent_owner="$(/usr/bin/stat -c '%u' -- "$node_parent")"
    node_parent_permissions="$(/usr/bin/stat -c '%a' -- "$node_parent")"
    if
      [ "$node_parent_owner" -ne 0 ] ||
      (( (8#$node_parent_permissions & 0022) != 0 ))
    then
      echo "Node binary ancestors must be root-owned without group/world write: $node_parent" >&2
      return 1
    fi
    [ "$node_parent" = "/" ] && break
    node_parent="$(/usr/bin/dirname -- "$node_parent")"
  done
  local node_identity
  local node_sha256
  node_identity="$(/usr/bin/stat -c '%d:%i' -- "$node_path")"
  node_sha256="$(/usr/bin/sha256sum -- "$node_path")"
  node_sha256="${node_sha256%% *}"
  local node_probe
  if ! node_probe="$(
    "$node_path" --input-type=module - "$node_path" 2>/dev/null <<'NODE'
import { realpathSync } from "node:fs";
const expectedPath = process.argv[2];
if (
  process.release?.name !== "node" ||
  realpathSync(process.execPath) !== expectedPath
) {
  process.exit(1);
}
process.stdout.write("agent-demo-video-node-ok");
NODE
  )" || [ "$node_probe" != "agent-demo-video-node-ok" ]; then
    echo "selected executable did not prove it is Node: $node_path" >&2
    return 1
  fi
  if
    [ "$(/usr/bin/stat -c '%d:%i' -- "$node_path")" != "$node_identity" ] ||
    [ "$(/usr/bin/sha256sum -- "$node_path" | { read -r hash _; printf '%s' "$hash"; })" != "$node_sha256" ]
  then
    echo "root-owned Node binary changed during admission: $node_path" >&2
    return 1
  fi
  printf '%s\n' "$node_path"
}

if [ "$#" -ne 3 ] || [ "${1:-}" != "--node-bin" ]; then
  echo "usage: $0 --node-bin <canonical-absolute-node-binary> <PRODUCTION_RECEIPT.md>" >&2
  exit 2
fi

factory_node_bin="$(factory_require_node_binary "$2")"
factory_receipt_path="$3"
if [ ! -s "$factory_receipt_path" ]; then
  echo "production receipt is missing or empty: $factory_receipt_path" >&2
  exit 1
fi

if /usr/bin/rg --no-config -i -q -- \
  '(^|[^[:alnum:]])(PENDING|TBD|TODO|FIXME|FILL[ _-]?ME|REPLACE[ _-]?ME|UNKNOWN|N/?A)([^[:alnum:]]|$)' \
  "$factory_receipt_path"; then
  echo "production receipt contains placeholder review evidence (for example PENDING or TBD)" >&2
  exit 1
else
  factory_placeholder_scan_status=$?
  if [ "$factory_placeholder_scan_status" -ne 1 ]; then
    echo "production receipt placeholder scan failed closed" >&2
    exit 1
  fi
fi

"$factory_node_bin" --input-type=module - "$factory_receipt_path" <<'NODE'
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const path = process.argv[2];
const root = dirname(path);
const text = readFileSync(path, "utf8");
const lines = text.split(/\r?\n/);

if (/^\s*(?:```|~~~)/m.test(text)) {
  throw new Error("production receipt may not hide authoritative fields in a fenced block");
}
if (/<!--|-->/s.test(text) || /^\s*<\/?[A-Za-z][^>]*>/m.test(text)) {
  throw new Error("production receipt may not contain HTML blocks or comments");
}

function bullet(label) {
  const prefix = `- ${label}:`;
  const matches = lines.filter((line) => line.startsWith(prefix));
  if (matches.length !== 1) {
    throw new Error(`production receipt must contain exactly one ${label} field`);
  }
  const value = matches[0].slice(prefix.length).trim();
  if (!value) throw new Error(`production receipt field is blank: ${label}`);
  return value;
}

function requirePattern(label, pattern, description) {
  const value = bullet(label);
  if (!pattern.test(value)) {
    throw new Error(`production receipt ${label} must be ${description}`);
  }
  return value;
}

requirePattern("Run ID", /^[A-Za-z0-9._-]+$/, "a filesystem-safe run ID");
const sourceCommit = requirePattern(
  "Source commit SHA",
  /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i,
  "a full Git commit SHA",
);
const attemptRoot = bullet("Attempt root");
const reviewedRoot = bullet("Reviewed root");
if (attemptRoot === reviewedRoot) {
  throw new Error("production receipt attempt and reviewed roots must differ");
}
const receiptBase = process.env.FACTORY_RECEIPT_BASE || process.cwd();
const expectedAttemptRoot = process.env.FACTORY_EXPECTED_ATTEMPT_ROOT;
const expectedReviewedRoot = process.env.FACTORY_EXPECTED_REVIEWED_ROOT;
try {
  execFileSync(
    "/usr/bin/git",
    [
      "--no-replace-objects",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-C",
      receiptBase,
      "cat-file",
      "-e",
      `${sourceCommit}^{commit}`,
    ],
    { stdio: "ignore", timeout: 15_000 },
  );
} catch {
  throw new Error("production receipt Source commit SHA does not resolve to a commit in the source repository");
}
if (expectedAttemptRoot && resolve(receiptBase, attemptRoot) !== expectedAttemptRoot) {
  throw new Error("production receipt Attempt root does not match the promoted source");
}
if (expectedReviewedRoot && resolve(receiptBase, reviewedRoot) !== expectedReviewedRoot) {
  throw new Error("production receipt Reviewed root does not match the promotion target");
}
bullet("Capture inventory reference");
const recordedClaimLedgerHash = requirePattern(
  "Claim ledger SHA-256",
  /^[0-9a-f]{64}$/i,
  "a SHA-256",
);
requirePattern("Claim source refresh date", /^\d{4}-\d{2}-\d{2}$/, "an ISO date");
bullet("Reviewer");
const reviewStart = requirePattern("Review start UTC", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/, "an ISO UTC timestamp");
const reviewStop = requirePattern("Review stop UTC", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/, "an ISO UTC timestamp");
const reviewMinutes = Number(bullet("Total Dan review minutes"));
if (!Number.isFinite(reviewMinutes) || reviewMinutes <= 0 || reviewMinutes > 30) {
  throw new Error("production receipt Total Dan review minutes must be greater than 0 and at most 30");
}
const measuredReviewMinutes = (Date.parse(reviewStop) - Date.parse(reviewStart)) / 60_000;
if (
  !Number.isFinite(measuredReviewMinutes) ||
  measuredReviewMinutes <= 0 ||
  Math.abs(measuredReviewMinutes - reviewMinutes) > 1
) {
  throw new Error("production receipt review timestamps must be ordered and match Total Dan review minutes");
}
if (bullet("Review decision and rationale").length < 10) {
  throw new Error("production receipt Review decision and rationale is too short");
}
if (bullet("Render handoff status") !== "REVIEWED_FOR_PUBLISH_HANDOFF") {
  throw new Error("production receipt must contain exactly one reviewed handoff status");
}
if (bullet("Dan publication approval") !== "NOT_REQUESTED") {
  throw new Error("pre-upload production receipt must keep Dan publication approval at NOT_REQUESTED");
}
if (bullet("Channel gate status") !== "NOT_EVALUATED") {
  throw new Error("pre-upload production receipt must keep channel gate status at NOT_EVALUATED");
}

const tableCells = (line) => line.split("|").slice(1, -1).map((cell) => cell.trim());
const artifactRows = lines
  .filter((line) => /^\|\s*(?:master|cut-a|cut-b|cut-c)\s*\|/.test(line))
  .map(tableCells);
const artifactNames = ["master", "cut-a", "cut-b", "cut-c"];
const sha256File = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
let actualClaimLedgerHash;
try {
  actualClaimLedgerHash = sha256File(join(root, "evidence", "source", "CLAIM_LEDGER.md"));
} catch (error) {
  throw new Error(`production receipt archived claim ledger is missing: ${error.message}`);
}
if (recordedClaimLedgerHash.toLowerCase() !== actualClaimLedgerHash) {
  throw new Error("production receipt Claim ledger SHA-256 does not match the archived claim ledger");
}
if (
  artifactRows.length !== artifactNames.length ||
  artifactNames.some((name) => artifactRows.filter((row) => row[0] === name).length !== 1)
) {
  throw new Error("production receipt must contain exactly one artifact row for master and each cut");
}
for (const row of artifactRows) {
  if (row.length !== 10 || row.some((cell) => !cell)) {
    throw new Error(`production receipt artifact row is incomplete: ${row[0] ?? "unknown"}`);
  }
  if (!/^[0-9a-f]{64}$/i.test(row[1]) || !/^[0-9a-f]{64}$/i.test(row[2])) {
    throw new Error(`production receipt artifact hashes are invalid: ${row[0]}`);
  }
  let actualFinalHash;
  let actualReportHash;
  let report;
  let probe;
  try {
    const finalPath = join(root, row[0], "final.mp4");
    actualFinalHash = sha256File(finalPath);
    probe = JSON.parse(execFileSync("/usr/bin/ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type,width,height,sample_aspect_ratio:stream_side_data=rotation:format=duration",
      "-of", "json",
      finalPath,
    ], { encoding: "utf8", timeout: 15_000 }));
    const reportBytes = readFileSync(join(root, row[0], "render-report.json"));
    actualReportHash = createHash("sha256").update(reportBytes).digest("hex");
    report = JSON.parse(reportBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`production receipt artifact files or report are invalid: ${row[0]}: ${error.message}`);
  }
  if (row[1].toLowerCase() !== actualFinalHash || row[2].toLowerCase() !== actualReportHash) {
    throw new Error(`production receipt artifact hashes do not match reviewed files: ${row[0]}`);
  }
  const expectedVoice = {
    voiceId: "AwstCxsCY8YE2KYw66By",
    modelId: "eleven_multilingual_v2",
    seed: 42,
    stability: 0.5,
    similarity: 0.75,
  };
  const expectedCap = row[0] === "master" ? 600 : 60;
  const reportedDuration = Number.parseFloat(row[3]);
  const expectedSize = row[0] === "master"
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };
  const videoStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === "video");
  const audioStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === "audio");
  const video = videoStreams[0];
  const probedDuration = Number.parseFloat(probe.format?.duration ?? "");
  const rotated = (video?.side_data_list ?? []).some(
    (sideData) => Number(sideData.rotation ?? 0) !== 0,
  );
  if (
    videoStreams.length !== 1 ||
    audioStreams.length < 1 ||
    video?.width !== expectedSize.width ||
    video?.height !== expectedSize.height ||
    video?.sample_aspect_ratio !== "1:1" ||
    rotated ||
    !Number.isFinite(probedDuration) ||
    report.ttsMode !== "real" ||
    Object.entries(expectedVoice).some(([key, value]) => report.voice?.[key] !== value) ||
    report.render?.parity?.ok !== true ||
    report.preflight?.ran !== true ||
    report.preflight?.declined !== false ||
    report.limits?.maxDurationSec !== expectedCap ||
    !Number.isFinite(report.render?.totalSec) ||
    !Number.isFinite(report.timeline?.totalSec) ||
    report.render.totalSec > expectedCap ||
    report.timeline.totalSec > expectedCap ||
    Math.abs(report.render.totalSec - report.timeline.totalSec) > 0.1 ||
    Math.abs(report.render.totalSec - reportedDuration) > 0.1 ||
    Math.abs(probedDuration - reportedDuration) > 0.1
  ) {
    throw new Error(`production receipt render report did not prove real pinned gated output: ${row[0]}`);
  }
  if (!/^\d+(?:\.\d+)?s$/.test(row[3])) {
    throw new Error(`production receipt artifact duration is invalid: ${row[0]}`);
  }
  const expectedGeometry = row[0] === "master"
    ? "1920x1080, SAR 1:1"
    : "1080x1920, SAR 1:1";
  if (row[4] !== expectedGeometry) {
    throw new Error(`production receipt artifact geometry or SAR is invalid: ${row[0]}`);
  }
  if (row[5] !== "PASS" || row[6] !== "REAL" || row[7] !== "PINNED") {
    throw new Error(`production receipt artifact media or TTS evidence is invalid: ${row[0]}`);
  }
  if (row[8] !== "PASS" || row[9] !== "ENFORCED") {
    throw new Error(`production receipt artifact parity or preflight evidence is invalid: ${row[0]}`);
  }
}
if (bullet("Input and output hash manifest") !== "`PRODUCTION_RECEIPT.sha256`") {
  throw new Error("production receipt must name the production hash manifest");
}
bullet("Toolchain versions");
const recordedChaptersHash = requirePattern(
  "YouTube chapters SHA-256",
  /^[0-9a-f]{64}$/i,
  "a SHA-256",
);
let actualChaptersHash;
try {
  actualChaptersHash = sha256File(join(root, "YOUTUBE_CHAPTERS.txt"));
} catch (error) {
  throw new Error(`production receipt chapter file is missing: ${error.message}`);
}
if (recordedChaptersHash.toLowerCase() !== actualChaptersHash) {
  throw new Error("production receipt chapter hash does not match YOUTUBE_CHAPTERS.txt");
}

for (let index = 1; index <= 8; index++) {
  const matches = lines.filter((line) => line.startsWith(`- R${index} `));
  if (matches.length !== 1 || !/:\s*\S/.test(matches[0])) {
    throw new Error(`production receipt run-dependent evidence is blank or duplicated: R${index}`);
  }
}

const playbackRows = [
  "master full mix, start UTC and stop UTC",
  "01-cold-open",
  "02-roadmap",
  "03-setup",
  "04-install-it-right",
  "05-first-real-task",
  "06-where-it-runs",
  "07-anywhere-on-a-schedule",
  "08-recap",
  "09-next",
  "cut-a full mix and hook, start UTC and stop UTC",
  "cut-b full mix and hook, start UTC and stop UTC",
  "cut-c full mix and hook, start UTC and stop UTC",
];
for (const name of playbackRows) {
  const matches = lines
    .filter((line) => line.startsWith(`| ${name} |`))
    .map(tableCells);
  if (
    matches.length !== 1 ||
    matches[0].length !== 3 ||
    !matches[0][1] ||
    matches[0][2] !== "PASS"
  ) {
    throw new Error(`production receipt playback evidence is incomplete: ${name}`);
  }
}

const checks = [
  "Review economics",
  "Claims",
  "Real captures",
  "Rights",
  "Dash-clean packaging",
  "Title and thumbnail",
  "Captions",
  "Audio",
  "Visual integrity",
  "Disclosure",
  "Vertical cuts",
  "Provenance",
];
const sectionMarkers = checks.map((name, index) => `### ${index + 1}. ${name}`);
const allNumberedHeadings = text.match(/^### \d+\. .*$/gm) ?? [];
if (allNumberedHeadings.length !== sectionMarkers.length) {
  throw new Error("production receipt must contain exactly the twelve named checklist sections");
}

let previousStart = -1;
for (let index = 0; index < sectionMarkers.length; index++) {
  const marker = sectionMarkers[index];
  if (text.split(marker).length - 1 !== 1) {
    throw new Error(`production receipt checklist section is missing or duplicated: ${marker}`);
  }
  const start = text.indexOf(marker);
  if (start <= previousStart) {
    throw new Error(`production receipt checklist section is out of order: ${marker}`);
  }
  const nextMarker = sectionMarkers[index + 1];
  const end = nextMarker ? text.indexOf(nextMarker) : text.length;
  const section = text.slice(start, end);
  const dispositions = section.match(/^- Disposition:.*$/gm) ?? [];
  if (dispositions.length !== 1 || dispositions[0] !== "- Disposition: PASS") {
    throw new Error(`production receipt checklist section did not pass: ${marker}`);
  }
  const evidence = section.match(/^- Operator evidence:\s*(.+)$/gm) ?? [];
  if (
    evidence.length !== 1 ||
    evidence[0].slice("- Operator evidence:".length).trim().length < 3
  ) {
    throw new Error(`production receipt checklist evidence is blank: ${marker}`);
  }
  if (index === 9) {
    const planned = section.match(/^- Planned platform AI-content answers and rationale:\s*(.+)$/gm) ?? [];
    if (
      planned.length !== 1 ||
      planned[0].slice("- Planned platform AI-content answers and rationale:".length).trim().length < 3
    ) {
      throw new Error("production receipt planned platform AI-content evidence is blank");
    }
  }
  previousStart = start;
}
NODE

factory_repo_root="$(cd "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
factory_receipt_file="$(realpath -e -- "$factory_receipt_path")"
factory_receipt_root="$(realpath -e -- "$(dirname -- "$factory_receipt_path")")"
factory_tsx_cli="$factory_repo_root/node_modules/tsx/dist/cli.mjs"
test -f "$factory_tsx_cli"
test ! -L "$factory_tsx_cli"
(
  cd "$factory_repo_root"
  "$factory_node_bin" \
    "$factory_tsx_cli" \
    --tsconfig "$factory_repo_root/tsconfig.json" \
    "$factory_repo_root/scripts/validate-factory-ai-at-work-inputs.ts" \
    "$factory_receipt_root" \
    "$factory_receipt_file"
)
