#!/usr/bin/env bash
set -euo pipefail

case "$-" in
  *p*) ;;
  *)
    builtin printf '%s\n' \
      "Stale render-input recovery requires Bash privileged startup mode (-p)" >&2
    builtin exit 2
    ;;
esac

# Privileged startup suppresses BASH_ENV and imported functions before this
# destructive helper loads. Pin system tool lookup and prevent loader or shell
# startup namespaces from reaching any child process.
PATH=/usr/bin:/bin
export PATH
hash -r
while IFS= read -r cleanup_environment_name; do
  case "$cleanup_environment_name" in
    BASH_ENV|ENV|CDPATH|LD_PRELOAD|LD_LIBRARY_PATH|LD_AUDIT)
      unset "$cleanup_environment_name"
      ;;
  esac
done < <(compgen -e)
unset cleanup_environment_name
LC_ALL=C
export LC_ALL

if [ "$#" -ne 5 ] || [ "${1:-}" != "--tmp-root" ] || [ "${3:-}" != "--older-than-seconds" ]; then
  echo "usage: $0 --tmp-root <absolute-temp-directory> --older-than-seconds <60..604800> <exact-render-input-root>" >&2
  exit 2
fi

cleanup_tmp_input="$2"
cleanup_age_seconds="$4"
cleanup_target_input="$5"

case "$cleanup_tmp_input" in
  /*) ;;
  *) echo "temporary root must be absolute" >&2; exit 2 ;;
esac
case "$cleanup_target_input" in
  /*) ;;
  *) echo "render-input root must be absolute" >&2; exit 2 ;;
esac
case "$cleanup_target_input" in
  /|*/)
    echo "render-input root must be one exact canonical directory path without a trailing slash" >&2
    exit 2
    ;;
esac
case "$cleanup_age_seconds" in
  ''|*[!0-9]*) echo "stale age must be an integer number of seconds" >&2; exit 2 ;;
esac
if [ "$cleanup_age_seconds" -lt 60 ] || [ "$cleanup_age_seconds" -gt 604800 ]; then
  echo "stale age must be between 60 and 604800 seconds" >&2
  exit 2
fi

if [ ! -d "$cleanup_tmp_input" ] || [ -L "$cleanup_tmp_input" ]; then
  echo "temporary root must be a non-symbolic-link directory" >&2
  exit 1
fi
cleanup_tmp_root="$(/usr/bin/realpath -e -- "$cleanup_tmp_input")"
if [ "$cleanup_tmp_input" != "$cleanup_tmp_root" ] || [ "$cleanup_tmp_root" = "/" ]; then
  echo "temporary root must be supplied as one exact canonical non-root path" >&2
  exit 1
fi
cleanup_tmp_owner="$(/usr/bin/stat -c '%u' -- "$cleanup_tmp_root")"
cleanup_tmp_mode="$(/usr/bin/stat -c '%a' -- "$cleanup_tmp_root")"
cleanup_tmp_mode_value=$((8#$cleanup_tmp_mode))
if [ "$cleanup_tmp_owner" -eq 0 ] && (( (cleanup_tmp_mode_value & 01000) != 0 )); then
  :
elif [ "$cleanup_tmp_owner" -eq "$EUID" ] && (( (cleanup_tmp_mode_value & 0022) == 0 )); then
  :
else
  echo "temporary root must be trusted: root-owned sticky or current-user-owned without group/world write" >&2
  exit 1
fi
cleanup_tmp_ancestor="$cleanup_tmp_root"
while true; do
  if [ ! -d "$cleanup_tmp_ancestor" ] || [ -L "$cleanup_tmp_ancestor" ]; then
    echo "temporary root ancestor is not trusted: $cleanup_tmp_ancestor" >&2
    exit 1
  fi
  cleanup_tmp_ancestor_owner="$(/usr/bin/stat -c '%u' -- "$cleanup_tmp_ancestor")"
  cleanup_tmp_ancestor_mode="$(/usr/bin/stat -c '%a' -- "$cleanup_tmp_ancestor")"
  cleanup_tmp_ancestor_mode_value=$((8#$cleanup_tmp_ancestor_mode))
  if
    [ "$cleanup_tmp_ancestor_owner" -eq 0 ] &&
    {
      (( (cleanup_tmp_ancestor_mode_value & 0022) == 0 )) ||
      (( (cleanup_tmp_ancestor_mode_value & 01000) != 0 ))
    }
  then
    :
  elif
    [ "$cleanup_tmp_ancestor_owner" -eq "$EUID" ] &&
    (( (cleanup_tmp_ancestor_mode_value & 0022) == 0 ))
  then
    :
  else
    echo "temporary root ancestor is not trusted: $cleanup_tmp_ancestor" >&2
    exit 1
  fi
  [ "$cleanup_tmp_ancestor" = "/" ] && break
  cleanup_tmp_ancestor="$(/usr/bin/dirname -- "$cleanup_tmp_ancestor")"
done
cleanup_target_parent="$(/usr/bin/realpath -e -- "$(/usr/bin/dirname -- "$cleanup_target_input")")"
cleanup_target_name="$(/usr/bin/basename -- "$cleanup_target_input")"
if [ "$cleanup_target_parent" != "$cleanup_tmp_root" ]; then
  echo "refusing render-input root outside the selected temporary root" >&2
  exit 1
fi
cleanup_target="$cleanup_tmp_root/$cleanup_target_name"
if [ "$cleanup_target_input" != "$cleanup_target" ]; then
  echo "render-input root must be supplied as its exact canonical path" >&2
  exit 1
fi
case "$cleanup_target_name" in
  agent-demo-video-render-inputs-*)
    cleanup_target_suffix="${cleanup_target_name#agent-demo-video-render-inputs-}"
    ;;
  *)
    echo "refusing unexpected render-input root name" >&2
    exit 1
    ;;
esac
if [[ ! "$cleanup_target_suffix" =~ ^([0-9]+)-([A-Za-z0-9]{6})$ ]]; then
  echo "refusing unexpected render-input root name" >&2
  exit 1
fi
cleanup_owner_pid="${BASH_REMATCH[1]}"
if [ -d "/proc/$cleanup_owner_pid" ]; then
  echo "render-input root owning process is still live: $cleanup_owner_pid" >&2
  exit 1
fi
if [ ! -d "$cleanup_target" ] || [ -L "$cleanup_target" ]; then
  echo "render-input root must be a non-symbolic-link directory" >&2
  exit 1
fi

cleanup_owner="$(/usr/bin/stat -c '%u' -- "$cleanup_target")"
cleanup_mode="$(/usr/bin/stat -c '%a' -- "$cleanup_target")"
cleanup_identity="$(/usr/bin/stat -c '%d:%i' -- "$cleanup_target")"
if [ "$cleanup_owner" -ne "$EUID" ] || [ "$cleanup_mode" != "700" ]; then
  echo "render-input root must be owned by the current user with mode 0700" >&2
  exit 1
fi
cleanup_marker="$cleanup_target/.agent-demo-video-private-input-root"
cleanup_marker_expected="agent-demo-video-private-input-root-v1"
if [ -L "$cleanup_marker" ] || [ ! -f "$cleanup_marker" ]; then
  echo "render-input root lacks its created-by-pipeline marker" >&2
  exit 1
fi
cleanup_marker_owner="$(/usr/bin/stat -c '%u' -- "$cleanup_marker")"
cleanup_marker_mode="$(/usr/bin/stat -c '%a' -- "$cleanup_marker")"
cleanup_marker_links="$(/usr/bin/stat -c '%h' -- "$cleanup_marker")"
cleanup_marker_size="$(/usr/bin/stat -c '%s' -- "$cleanup_marker")"
cleanup_marker_content="$(/usr/bin/cat -- "$cleanup_marker")"
if
  [ "$cleanup_marker_owner" -ne "$EUID" ] ||
  [ "$cleanup_marker_mode" != "400" ] ||
  [ "$cleanup_marker_links" -ne 1 ] ||
  [ "$cleanup_marker_size" -ne $((${#cleanup_marker_expected} + 1)) ] ||
  [ "$cleanup_marker_content" != "$cleanup_marker_expected" ]
then
  echo "render-input root has an invalid created-by-pipeline marker" >&2
  exit 1
fi

cleanup_now="$(/usr/bin/date +%s)"
cleanup_mtime="$(/usr/bin/stat -c '%Y' -- "$cleanup_target")"
cleanup_age=$((cleanup_now - cleanup_mtime))
if [ "$cleanup_age" -lt "$cleanup_age_seconds" ]; then
  echo "render-input root is not old enough for stale recovery: $cleanup_target" >&2
  exit 1
fi

# Refuse a target or descendant mount before recursive deletion. Linux
# mountinfo escapes whitespace and backslashes in the mountpoint field; decode
# those four standard sequences before comparing exact path boundaries.
while IFS=' ' read -r _ _ _ _ cleanup_mountpoint _; do
  cleanup_mountpoint="${cleanup_mountpoint//\\040/ }"
  cleanup_mountpoint="${cleanup_mountpoint//\\011/$'\t'}"
  cleanup_mountpoint="${cleanup_mountpoint//\\012/$'\n'}"
  cleanup_mountpoint="${cleanup_mountpoint//\\134/\\}"
  case "$cleanup_mountpoint" in
    "$cleanup_target"|"$cleanup_target"/*)
      echo "refusing stale render-input root with a nested mount: $cleanup_mountpoint" >&2
      exit 1
      ;;
  esac
done < /proc/self/mountinfo

# Recheck the authenticated identity immediately before the one exact removal.
# A malicious process with the same Unix identity remains outside this tool's
# isolation boundary, matching the render pipeline's documented boundary.
if [ "$(/usr/bin/stat -c '%d:%i' -- "$cleanup_target")" != "$cleanup_identity" ]; then
  echo "render-input root identity changed before removal" >&2
  exit 1
fi
/usr/bin/rm -rf --one-file-system -- "$cleanup_target"
if [ -e "$cleanup_target" ] || [ -L "$cleanup_target" ]; then
  echo "stale render-input root removal did not complete: $cleanup_target" >&2
  exit 1
fi
if ! builtin printf 'removed stale private render-input root: %s\n' "$cleanup_target"; then
  builtin printf \
    'removed stale private render-input root, but stdout status reporting failed: %s\n' \
    "$cleanup_target" >&2 || :
fi
builtin exit 0
