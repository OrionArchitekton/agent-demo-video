#!/usr/bin/env bash
set -euo pipefail

case "$-" in
  *p*) ;;
  *)
    builtin printf '%s\n' \
      "Factory promotion requires Bash privileged startup mode (-p)" >&2
    builtin exit 2
    ;;
esac

# Privileged startup suppresses BASH_ENV and imported functions before this
# script loads. Fix tool lookup and remove the remaining runtime injection
# namespaces before invoking any semantic validator.
PATH=/usr/bin:/bin
export PATH
hash -r
while IFS= read -r factory_environment_name; do
  case "$factory_environment_name" in
    BASH_ENV|ENV|CDPATH|LD_PRELOAD|LD_LIBRARY_PATH|LD_AUDIT|GIT_*|NODE_*|TSX_*|ESBUILD_BINARY_PATH|NPM_CONFIG_*|npm_config_*|PNPM_*|COREPACK_*)
      unset "$factory_environment_name"
      ;;
  esac
done < <(compgen -e)
unset factory_environment_name

# The sealed manifest is a byte-order contract. Pin collation so creation and
# later verification cannot disagree when the operator's locale changes.
LC_ALL=C
export LC_ALL

factory_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
factory_receipt_validator="$factory_repo_root/scripts/validate-factory-ai-at-work-receipt.sh"
factory_expected_attempt_root=""
factory_expected_reviewed_root=""

factory_strip_trailing_slashes() {
  local path="$1"
  while [ "$path" != "/" ] && [ "${path%/}" != "$path" ]; do
    path="${path%/}"
  done
  printf '%s\n' "$path"
}

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

factory_generate_manifest() {
  local root="$1"
  (
    cd "$root"
    find . -xdev -type f ! -path './PRODUCTION_RECEIPT.sha256' -print0 \
      | sort -z \
      | xargs -0 -r sha256sum --
  )
}

factory_require_exact_entries() {
  local root="$1"
  local label="$2"
  shift 2

  local dotglob_was_set=0
  local nullglob_was_set=0
  shopt -q dotglob && dotglob_was_set=1
  shopt -q nullglob && nullglob_was_set=1
  shopt -s dotglob nullglob
  local -a entries=("$root"/*)
  (( dotglob_was_set )) || shopt -u dotglob
  (( nullglob_was_set )) || shopt -u nullglob

  if [ "${#entries[@]}" -ne "$#" ]; then
    echo "$label does not contain the exact required entry count" >&2
    return 1
  fi

  local entry
  local name
  local expected_name
  local matched
  for entry in "${entries[@]}"; do
    name="${entry##*/}"
    matched=0
    for expected_name in "$@"; do
      if [ "$name" = "$expected_name" ]; then
        matched=1
        break
      fi
    done
    if [ "$matched" -ne 1 ]; then
      echo "$label contains an unexpected entry: $entry" >&2
      return 1
    fi
  done
}

factory_require_allowed_entries() {
  local root="$1"
  local label="$2"
  shift 2

  local dotglob_was_set=0
  local nullglob_was_set=0
  shopt -q dotglob && dotglob_was_set=1
  shopt -q nullglob && nullglob_was_set=1
  shopt -s dotglob nullglob
  local -a entries=("$root"/*)
  (( dotglob_was_set )) || shopt -u dotglob
  (( nullglob_was_set )) || shopt -u nullglob

  local entry
  local name
  local allowed_name
  local matched
  for entry in "${entries[@]}"; do
    name="${entry##*/}"
    matched=0
    for allowed_name in "$@"; do
      if [ "$name" = "$allowed_name" ]; then
        matched=1
        break
      fi
    done
    if [ "$matched" -ne 1 ]; then
      echo "$label contains an unexpected entry: $entry" >&2
      return 1
    fi
  done
}

factory_require_named_regular_files() {
  local root="$1"
  local label="$2"
  shift 2

  local name
  for name in "$@"; do
    if [ -L "$root/$name" ] || [ ! -f "$root/$name" ]; then
      echo "$label must be a regular file: $root/$name" >&2
      return 1
    fi
  done
}

factory_validate_artifact_topology() {
  local root="$1"
  local artifact="$2"

  factory_require_exact_entries \
    "$root" \
    "$artifact artifact root" \
    .agent-demo-video-output-claim \
    audio \
    seg \
    captions.srt \
    captions.ass \
    video.mp4 \
    audio.mp3 \
    muxed.mp4 \
    final.mp4 \
    render-report.json
  factory_require_named_regular_files \
    "$root" \
    "$artifact renderer output" \
    .agent-demo-video-output-claim \
    captions.srt \
    captions.ass \
    video.mp4 \
    audio.mp3 \
    muxed.mp4 \
    final.mp4 \
    render-report.json
  test -f "$root/.agent-demo-video-output-claim"
  test ! -s "$root/.agent-demo-video-output-claim"
  test -d "$root/audio"
  test -d "$root/seg"

  local -a shot_ids
  local segment_last
  case "$artifact" in
    master)
      shot_ids=(
        01-cold-open
        02-roadmap
        03-setup
        04-install-it-right
        05-first-real-task
        06-where-it-runs
        07-anywhere-on-a-schedule
        08-recap
        09-next
        __card-end
      )
      segment_last=9
      ;;
    cut-a)
      shot_ids=(cut-a-install)
      segment_last=0
      ;;
    cut-b)
      shot_ids=(cut-b-real-job)
      segment_last=0
      ;;
    cut-c)
      shot_ids=(cut-c-remote)
      segment_last=0
      ;;
    *)
      echo "unknown production artifact: $artifact" >&2
      return 1
      ;;
  esac

  local -a audio_entries=(list.txt bed.wav tick.wav sweep.wav mix.m4a)
  local shot_id
  for shot_id in "${shot_ids[@]}"; do
    audio_entries+=("$shot_id.mp3")
  done

  local index
  for (( index = 0; index <= segment_last; index++ )); do
    audio_entries+=("pad_$index.mp3")
  done
  factory_require_exact_entries \
    "$root/audio" \
    "$artifact audio artifacts" \
    "${audio_entries[@]}"
  factory_require_named_regular_files \
    "$root/audio" \
    "$artifact audio artifact" \
    "${audio_entries[@]}"

  local -a required_segments=(list.txt)
  if [ "$artifact" = "master" ]; then
    required_segments+=(card_title_text.txt card_url_text.txt card_end.mp4)
  fi
  for (( index = 0; index <= segment_last; index++ )); do
    required_segments+=("seg_$index.mp4")
  done

  local -a allowed_segments=("${required_segments[@]}")
  for (( index = 0; index <= segment_last; index++ )); do
    allowed_segments+=("seg_$index.ext.mp4")
  done
  factory_require_allowed_entries \
    "$root/seg" \
    "$artifact segment artifacts" \
    "${allowed_segments[@]}"

  local required_segment
  for required_segment in "${required_segments[@]}"; do
    test -f "$root/seg/$required_segment"
  done
}

factory_validate_topology() {
  local root="$1"
  local state="$2"
  local -a root_entries=(
    PRODUCTION_RECEIPT.md
    YOUTUBE_CHAPTERS.txt
    evidence
    master
    cut-a
    cut-b
    cut-c
  )
  if [ "$state" = "closed" ]; then
    root_entries+=(PRODUCTION_RECEIPT.sha256)
  fi

  factory_require_exact_entries "$root" "production root" "${root_entries[@]}"
  factory_require_exact_entries "$root/evidence" "evidence root" clips source
  factory_require_exact_entries \
    "$root/evidence/clips" \
    "clip evidence root" \
    master cut-a cut-b cut-c
  factory_require_exact_entries \
    "$root/evidence/source" \
    "source evidence root" \
    CAPTURE_PLAN.md CLAIM_LEDGER.md PUBLISHING.md README.md master cuts
  factory_require_exact_entries \
    "$root/evidence/source/master" \
    "master source evidence" \
    DEMO_SCRIPT.md demo.config.json
  factory_require_exact_entries \
    "$root/evidence/source/cuts" \
    "cut source evidence root" \
    cut-a cut-b cut-c
  local artifact
  for artifact in cut-a cut-b cut-c; do
    factory_require_exact_entries \
      "$root/evidence/source/cuts/$artifact" \
      "$artifact source evidence" \
      DEMO_SCRIPT.md demo.config.json
  done
  factory_require_exact_entries \
    "$root/evidence/clips/master" \
    "master clip evidence" \
    01-cold-open.mp4 \
    02-roadmap.mp4 \
    03-setup.mp4 \
    04-install-it-right.mp4 \
    05-first-real-task.mp4 \
    06-where-it-runs.mp4 \
    07-anywhere-on-a-schedule.mp4 \
    08-recap.mp4 \
    09-next.mp4
  factory_require_exact_entries \
    "$root/evidence/clips/cut-a" \
    "cut-a clip evidence" \
    cut-a-install.mp4
  factory_require_exact_entries \
    "$root/evidence/clips/cut-b" \
    "cut-b clip evidence" \
    cut-b-real-job.mp4
  factory_require_exact_entries \
    "$root/evidence/clips/cut-c" \
    "cut-c clip evidence" \
    cut-c-remote.mp4
  for artifact in master cut-a cut-b cut-c; do
    factory_validate_artifact_topology "$root/$artifact" "$artifact"
  done
}

factory_reject_unlisted_types() {
  local root="$1"
  local unexpected
  unexpected="$(find "$root" -xdev ! -type d ! -type f -print -quit)"
  if [ -n "$unexpected" ]; then
    echo "production attempt contains an unlisted filesystem object: $unexpected" >&2
    return 1
  fi
  local hardlink
  hardlink="$(find "$root" -xdev -type f -links +1 -print -quit)"
  if [ -n "$hardlink" ]; then
    echo "production attempt contains a hard-linked file: $hardlink" >&2
    return 1
  fi
}

factory_reject_nested_mounts() {
  local root="$1"
  if ! command -v mountpoint >/dev/null 2>&1; then
    echo "mountpoint is required to prove the production root has no nested filesystems" >&2
    return 1
  fi

  local nested_mount
  if ! nested_mount="$(
    find "$root" -xdev -mindepth 1 \
      -exec mountpoint -q --nofollow -- {} \; \
      -print -quit
  )"; then
    echo "could not inspect production root for nested devices or mounts: $root" >&2
    return 1
  fi
  if [ -n "$nested_mount" ]; then
    echo "production root contains a nested device or mount: $nested_mount" >&2
    return 1
  fi
}

factory_assert_bounded_root() {
  local root="$1"
  local label="$2"
  local parent
  parent="$(dirname -- "$root")"
  if [ "$root" = "/" ] || [ "$parent" = "/" ] || [ "$root" = "$factory_repo_root" ]; then
    echo "$label root is too broad for recursive pack operations: $root" >&2
    return 1
  fi
}

factory_nearest_existing_ancestor() {
  local path="$1"
  while [ ! -e "$path" ] && [ ! -L "$path" ]; do
    local parent
    parent="$(dirname -- "$path")"
    if [ "$parent" = "$path" ]; then
      echo "could not locate an existing destination ancestor for $1" >&2
      return 1
    fi
    path="$parent"
  done
  realpath -e -- "$path"
}

factory_random_token() {
  local token
  if ! token="$(od -An -N16 -tx1 /dev/urandom | tr -d '[:space:]')"; then
    echo "could not generate a private promotion name" >&2
    return 1
  fi
  if [[ ! "$token" =~ ^[0-9a-f]{32}$ ]]; then
    echo "private promotion token has an invalid shape" >&2
    return 1
  fi
  printf '%s\n' "$token"
}

factory_validate_attempt_root() {
  local root="$1"
  test -d "$root"
  test ! -L "$root"
  factory_reject_unlisted_types "$root"
  factory_reject_nested_mounts "$root"
  factory_validate_topology "$root" "open"
  test -s "$root/PRODUCTION_RECEIPT.md"
  test -s "$root/YOUTUBE_CHAPTERS.txt"
  for artifact in master cut-a cut-b cut-c; do
    test -s "$root/$artifact/final.mp4"
    test -s "$root/$artifact/render-report.json"
  done
  test -d "$root/evidence"
  test ! -e "$root/PRODUCTION_RECEIPT.sha256"

  local foreign_owner
  foreign_owner="$(find "$root" -xdev ! -uid "$(id -u)" -print -quit)"
  if [ -n "$foreign_owner" ]; then
    echo "production attempt contains an object owned by another user: $foreign_owner" >&2
    return 1
  fi

  FACTORY_RECEIPT_BASE="$factory_repo_root" \
  FACTORY_EXPECTED_ATTEMPT_ROOT="$factory_expected_attempt_root" \
  FACTORY_EXPECTED_REVIEWED_ROOT="$factory_expected_reviewed_root" \
    /usr/bin/bash --noprofile --norc -p \
      "$factory_receipt_validator" \
      --node-bin "$factory_node_bin" \
      "$root/PRODUCTION_RECEIPT.md" \
      >/dev/null
}

factory_verify_closed_root() {
  local root="$1"
  test -d "$root"
  test ! -L "$root"
  test -s "$root/PRODUCTION_RECEIPT.sha256"
  test -s "$root/YOUTUBE_CHAPTERS.txt"
  factory_reject_unlisted_types "$root"
  factory_reject_nested_mounts "$root"
  local writable
  writable="$(find "$root" -xdev -perm /222 -print -quit)"
  if [ -n "$writable" ]; then
    echo "reviewed production root is not sealed read-only: $writable" >&2
    return 1
  fi
  factory_validate_topology "$root" "closed"

  local generated_manifest
  local recorded_manifest
  if ! generated_manifest="$(factory_generate_manifest "$root")"; then
    return 1
  fi
  if ! recorded_manifest="$(cat -- "$root/PRODUCTION_RECEIPT.sha256")"; then
    return 1
  fi
  if [ "$generated_manifest" != "$recorded_manifest" ]; then
    echo "production manifest is not a closed match for every regular file" >&2
    return 1
  fi
  (
    cd "$root"
    sha256sum -c --status PRODUCTION_RECEIPT.sha256
  )
  # This is the final semantic check. The closed manifest check above binds the
  # exact receipt bytes and every other regular file in this read-only root.
  FACTORY_RECEIPT_BASE="$factory_repo_root" \
  FACTORY_EXPECTED_ATTEMPT_ROOT="$factory_expected_attempt_root" \
  FACTORY_EXPECTED_REVIEWED_ROOT="$factory_expected_reviewed_root" \
    /usr/bin/bash --noprofile --norc -p \
      "$factory_receipt_validator" \
      --node-bin "$factory_node_bin" \
      "$root/PRODUCTION_RECEIPT.md" \
      >/dev/null
}

factory_pack_path_matches_identity() {
  local candidate="$1"
  local candidate_identity

  [ -n "$candidate" ] || return 1
  [ -d "$candidate" ] || return 1
  [ ! -L "$candidate" ] || return 1
  if ! candidate_identity="$(stat -c '%d:%i' -- "$candidate" 2>/dev/null)"; then
    return 1
  fi
  [ "$candidate_identity" = "$factory_pack_identity" ]
}

factory_promotion_cleanup() {
  local cleanup_status=$?
  local retained_root=""

  # Prevent EXIT recursion and defer any repeated signal until this bounded
  # recovery has restored or identified the authenticated pack.
  trap - EXIT
  trap '' HUP INT TERM
  set +e

  case "$factory_promotion_phase" in
    private-writable)
      if factory_pack_path_matches_identity "$factory_attempt_root"; then
        # The private rename did not happen, or recovery already completed.
        :
      elif factory_pack_path_matches_identity "$factory_promoting_root" &&
           [ ! -e "$factory_attempt_root" ] &&
           [ ! -L "$factory_attempt_root" ]; then
        if mv -T --no-clobber -- "$factory_promoting_root" "$factory_attempt_root" &&
           factory_pack_path_matches_identity "$factory_attempt_root" &&
           [ ! -e "$factory_promoting_root" ] &&
           [ ! -L "$factory_promoting_root" ]; then
          builtin printf 'restored interrupted promotion to %s\n' \
            "$factory_attempt_root" >&2
        else
          retained_root="$factory_promoting_root"
        fi
      else
        retained_root="$factory_promoting_root"
      fi
      if [ -n "$retained_root" ]; then
        if factory_pack_path_matches_identity "$retained_root"; then
          builtin printf \
            'could not safely restore interrupted promotion; retained authenticated pack at %s\n' \
            "$retained_root" >&2
        else
          builtin printf \
            'could not authenticate interrupted promotion; inspect %s and %s without mutating either path\n' \
            "$factory_attempt_root" "$factory_promoting_root" >&2
        fi
      fi
      ;;
    sealing|sealed|final-rename)
      if factory_pack_path_matches_identity "$factory_promoting_root"; then
        builtin printf \
          'promotion stopped during %s; retained authenticated pack at %s\n' \
          "$factory_promotion_phase" "$factory_promoting_root" >&2
      elif factory_pack_path_matches_identity "$factory_reviewed_root"; then
        builtin printf \
          'promotion stopped during %s; reviewed pack remains at %s\n' \
          "$factory_promotion_phase" "$factory_reviewed_root" >&2
      else
        builtin printf \
          'promotion stopped during %s; inspect %s and %s without mutating either path\n' \
          "$factory_promotion_phase" \
          "$factory_promoting_root" \
          "$factory_reviewed_root" >&2
      fi
      ;;
    reviewed)
      if factory_pack_path_matches_identity "$factory_reviewed_root"; then
        builtin printf \
          'post-promotion verification stopped; reviewed pack remains at %s\n' \
          "$factory_reviewed_root" >&2
      elif factory_pack_path_matches_identity "$factory_promoting_root"; then
        builtin printf \
          'post-promotion verification stopped; sealed pack remains at %s\n' \
          "$factory_promoting_root" >&2
      else
        builtin printf \
          'post-promotion verification stopped; inspect %s and %s without mutating either path\n' \
          "$factory_promoting_root" "$factory_reviewed_root" >&2
      fi
      ;;
  esac

  exit "$cleanup_status"
}

if [ "$#" -lt 2 ] || [ "${1:-}" != "--node-bin" ]; then
  echo "usage: $0 --node-bin <canonical-absolute-node-binary> <attempt-root> <reviewed-root>" >&2
  echo "       $0 --node-bin <canonical-absolute-node-binary> --verify <reviewed-root>" >&2
  exit 2
fi
factory_node_bin="$(factory_require_node_binary "$2")"
shift 2

if [ "${1:-}" = "--verify" ]; then
  if [ "$#" -ne 2 ]; then
    echo "usage: $0 --node-bin <canonical-absolute-node-binary> --verify <reviewed-root>" >&2
    exit 2
  fi
  factory_verify_operand="$(factory_strip_trailing_slashes "$2")"
  if [ -L "$factory_verify_operand" ]; then
    echo "reviewed root may not be a symlink: $2" >&2
    exit 1
  fi
  factory_verify_root="$(realpath -e -- "$factory_verify_operand")"
  factory_expected_reviewed_root="$factory_verify_root"
  factory_verify_closed_root "$factory_verify_root"
  exit 0
fi

if [ "$#" -ne 2 ]; then
  echo "usage: $0 --node-bin <canonical-absolute-node-binary> <attempt-root> <reviewed-root>" >&2
  exit 2
fi

factory_attempt_operand="$(factory_strip_trailing_slashes "$1")"
factory_reviewed_operand="$(factory_strip_trailing_slashes "$2")"
if [ -L "$factory_attempt_operand" ]; then
  echo "attempt root may not be a symlink: $1" >&2
  exit 1
fi
if [ -L "$factory_reviewed_operand" ]; then
  echo "reviewed root may not be a symlink: $2" >&2
  exit 1
fi
factory_attempt_root="$(realpath -e -- "$factory_attempt_operand")"
factory_reviewed_root="$(realpath -m -- "$factory_reviewed_operand")"
factory_reviewed_parent="$(dirname -- "$factory_reviewed_root")"
factory_reviewed_name="$(basename -- "$factory_reviewed_root")"
factory_expected_attempt_root="$factory_attempt_root"
factory_expected_reviewed_root="$factory_reviewed_root"

factory_assert_bounded_root "$factory_attempt_root" "attempt"
factory_assert_bounded_root "$factory_reviewed_root" "reviewed"
if [ "$factory_attempt_root" = "$factory_reviewed_root" ]; then
  echo "attempt and reviewed roots must differ" >&2
  exit 1
fi
case "$factory_reviewed_root/" in
  "$factory_attempt_root/"*)
    echo "reviewed root may not be inside the attempt root" >&2
    exit 1
    ;;
esac
case "$factory_attempt_root/" in
  "$factory_reviewed_root/"*)
    echo "attempt root may not be inside the reviewed root" >&2
    exit 1
    ;;
esac

test ! -e "$factory_reviewed_root"
test ! -L "$factory_reviewed_root"
factory_pack_identity="$(stat -c '%d:%i' -- "$factory_attempt_root")"
factory_pack_device="$(stat -c '%d' -- "$factory_attempt_root")"

# Compare the source device with the nearest existing destination ancestor
# before semantic validation and before creating any destination directories.
factory_destination_ancestor="$(factory_nearest_existing_ancestor "$factory_reviewed_parent")"
if [ "$(stat -c '%d' -- "$factory_destination_ancestor")" != "$factory_pack_device" ]; then
  echo "attempt and reviewed destination are on different filesystems; refusing promotion" >&2
  exit 1
fi

# All checks before this point and the semantic validation below are read-only.
# A typo or unrelated source therefore cannot create a manifest or recursively
# remove write permissions before it proves that it is the expected Gate 1 pack.
factory_validate_attempt_root "$factory_attempt_root"
if [ "$(stat -c '%d:%i' -- "$factory_attempt_root")" != "$factory_pack_identity" ]; then
  echo "attempt root changed identity during validation" >&2
  exit 1
fi

mkdir -p -- "$factory_reviewed_parent"
factory_reviewed_parent="$(realpath -e -- "$factory_reviewed_parent")"
factory_reviewed_root="$factory_reviewed_parent/$factory_reviewed_name"
factory_expected_reviewed_root="$factory_reviewed_root"
test ! -e "$factory_reviewed_root"
test ! -L "$factory_reviewed_root"
if [ "$(stat -c '%d' -- "$factory_reviewed_parent")" != "$factory_pack_device" ]; then
  echo "attempt and reviewed parent are on different filesystems; refusing promotion" >&2
  exit 1
fi
factory_validate_attempt_root "$factory_attempt_root"
if [ "$(stat -c '%d:%i' -- "$factory_attempt_root")" != "$factory_pack_identity" ]; then
  echo "attempt root changed identity while the reviewed parent was prepared" >&2
  exit 1
fi

exec {factory_pack_fd}< "$factory_attempt_root"
factory_pack_handle="/proc/$$/fd/$factory_pack_fd"
factory_pack_tree="$factory_pack_handle/"
if [ "$(stat -Lc '%d:%i' -- "$factory_pack_handle")" != "$factory_pack_identity" ]; then
  echo "opened pack handle does not identify the validated attempt" >&2
  exit 1
fi

# Move the authenticated, still-writable attempt to an unpredictable private
# same-filesystem name before creating a manifest or changing any permissions.
# A cooperative collision leaves the attempt and collision object untouched.
factory_private_token="$(factory_random_token)"
factory_promoting_root="$factory_reviewed_parent/.${factory_reviewed_name}.promoting-$factory_private_token"
test ! -e "$factory_promoting_root"
test ! -L "$factory_promoting_root"
factory_promotion_phase="private-writable"
trap factory_promotion_cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
if ! mv -T --no-clobber -- "$factory_attempt_root" "$factory_promoting_root"; then
  factory_promotion_phase="before-private-rename"
  echo "could not move the validated pack to its private promotion name" >&2
  exit 1
fi
if [ -e "$factory_attempt_root" ] || [ ! -d "$factory_promoting_root" ]; then
  echo "private promotion rename was not exclusive; inspect the untouched names" >&2
  exit 1
fi
if [ "$(stat -c '%d:%i' -- "$factory_promoting_root")" != "$factory_pack_identity" ] || \
   [ "$(stat -Lc '%d:%i' -- "$factory_pack_handle")" != "$factory_pack_identity" ]; then
  echo "private promotion name does not identify the validated pack" >&2
  exit 1
fi

# Recheck the complete open-pack contract at the private pathname. Only after
# that name and the open directory handle agree may sealing mutate the pack.
factory_validate_attempt_root "$factory_promoting_root"
if [ "$(stat -c '%d:%i' -- "$factory_promoting_root")" != "$factory_pack_identity" ]; then
  echo "private production pack changed identity before sealing" >&2
  exit 1
fi
if [ "$(stat -c '%d' -- "$factory_promoting_root")" != \
     "$(stat -c '%d' -- "$factory_reviewed_parent")" ]; then
  echo "private pack and reviewed parent are on different filesystems" >&2
  exit 1
fi

# Claim the manifest with one O_EXCL-style noclobber open through the
# authenticated directory handle. Keep its descriptor and inode identity while
# sealing and enumerating; never truncate a pathname installed by another run.
factory_promotion_phase="sealing"
set -o noclobber
if ! exec {factory_manifest_fd}> "${factory_pack_tree}PRODUCTION_RECEIPT.sha256"; then
  set +o noclobber
  echo "production manifest path was claimed concurrently" >&2
  exit 1
fi
set +o noclobber
factory_manifest_identity="$(stat -Lc '%d:%i' -- "/proc/$$/fd/$factory_manifest_fd")"

# Recursive permission mutation is rooted only at the authenticated open
# directory handle, after exact topology and nested-mount checks have passed.
chmod -R a-w -- "$factory_pack_tree"
if [ "$(stat -c '%d:%i' -- "$factory_promoting_root")" != "$factory_pack_identity" ] || \
   [ "$(stat -Lc '%d:%i' -- "$factory_pack_handle")" != "$factory_pack_identity" ]; then
  echo "private production pack changed identity while being sealed" >&2
  exit 1
fi
factory_reject_unlisted_types "$factory_pack_tree"
factory_reject_nested_mounts "$factory_pack_tree"
factory_validate_topology "$factory_pack_tree" "closed"
test -s "${factory_pack_tree}YOUTUBE_CHAPTERS.txt"
factory_generate_manifest "$factory_pack_tree" >&"$factory_manifest_fd"
if [ "$(stat -c '%d:%i' -- "${factory_pack_tree}PRODUCTION_RECEIPT.sha256")" != "$factory_manifest_identity" ]; then
  echo "production manifest pathname changed identity during creation" >&2
  exit 1
fi
exec {factory_manifest_fd}>&-
factory_verify_closed_root "$factory_promoting_root"
factory_promotion_phase="sealed"

factory_promotion_phase="final-rename"
if ! mv -T --no-clobber -- "$factory_promoting_root" "$factory_reviewed_root"; then
  echo "could not move the sealed pack to the reviewed target" >&2
  exit 1
fi
factory_promotion_phase="reviewed"
if [ -e "$factory_promoting_root" ] || [ ! -d "$factory_reviewed_root" ]; then
  echo "reviewed target appeared during promotion; sealed pack remains at $factory_promoting_root" >&2
  exit 1
fi
if [ "$(stat -c '%d:%i' -- "$factory_reviewed_root")" != "$factory_pack_identity" ] || \
   [ "$(stat -Lc '%d:%i' -- "$factory_pack_handle")" != "$factory_pack_identity" ]; then
  echo "reviewed target does not identify the sealed pack" >&2
  exit 1
fi
if ! factory_verify_closed_root "$factory_reviewed_root"; then
  echo "post-promotion verification failed; the read-only pack remains at $factory_reviewed_root for quarantine" >&2
  exit 1
fi
exec {factory_pack_fd}>&-
factory_promotion_phase="complete"
trap - EXIT HUP INT TERM

# The reviewed state is already committed and independently verified. Status
# output must not retroactively turn that durable success into an unretryable
# failure when stdout closes or its logging filesystem fills.
if ! sha256sum -- "$factory_reviewed_root/PRODUCTION_RECEIPT.sha256"; then
  builtin printf \
    'promotion committed and verified at %s, but its status digest could not be written\n' \
    "$factory_reviewed_root" >&2 || :
fi
exit 0
