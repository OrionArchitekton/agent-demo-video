#!/usr/bin/env bash
set -euo pipefail

# `bash -p` suppresses BASH_ENV and imported shell functions before any streamed
# bytes execute. Fix the remaining command search path before invoking an
# external program, then clear Bash's remembered command locations.
PATH=/usr/bin:/bin
export PATH
hash -r

factory_fail() {
  echo "source-attested render refused: $*" >&2
  exit 1
}

# A mutable checkout copy can execute and then restore itself before any
# in-process check. Require the operator to stream this launcher's bytes from
# the fixed commit with `git show ... | bash -p -s -- ...`.
if [ -n "${BASH_SOURCE[0]:-}" ]; then
  factory_fail "launcher must be streamed from the fixed Git commit, not executed by pathname"
fi

case "$-" in
  *p*) ;;
  *) factory_fail "launcher requires Bash privileged startup mode (-p)" ;;
esac

# No caller-selected Git authority or Node preload may cross the snapshot
# boundary. The launcher itself uses only Bash and system tools.
while IFS= read -r factory_environment_name; do
  case "$factory_environment_name" in
    BASH_ENV|ENV|CDPATH|LD_PRELOAD|LD_LIBRARY_PATH|LD_AUDIT|GIT_*|TAR_OPTIONS|TAPE|RSH|NODE_*|TSX_*|ESBUILD_BINARY_PATH|NPM_CONFIG_*|npm_config_*|PNPM_*|COREPACK_*|FAKE_TTS)
      unset "$factory_environment_name"
      ;;
  esac
done < <(compgen -e)
unset factory_environment_name
GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_GLOBAL=/dev/null
GIT_ATTR_NOSYSTEM=1
export GIT_CONFIG_NOSYSTEM GIT_CONFIG_GLOBAL GIT_ATTR_NOSYSTEM

factory_git() {
  /usr/bin/git \
    --no-replace-objects \
    -c core.hooksPath=/dev/null \
    -c core.fsmonitor=false \
    "$@"
}

if [ "$#" -lt 3 ]; then
  factory_fail "usage: <repo-root> <full-commit> [--verify-only] [--node-bin <absolute-path> --pnpm-cli <absolute-path>] -- <absolute-config> [CLI args]"
fi

factory_repo_input="$1"
factory_commit_input="$2"
shift 2
factory_verify_only=false
factory_node_input=""
factory_pnpm_cli_input=""
factory_saw_separator=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --verify-only)
      if [ "$factory_verify_only" = true ]; then
        factory_fail "--verify-only may be supplied once"
      fi
      factory_verify_only=true
      shift
      ;;
    --node-bin)
      if [ -n "$factory_node_input" ] || [ "$#" -lt 2 ]; then
        factory_fail "--node-bin requires one absolute path and may be supplied once"
      fi
      factory_node_input="$2"
      shift 2
      ;;
    --pnpm-cli)
      if [ -n "$factory_pnpm_cli_input" ] || [ "$#" -lt 2 ]; then
        factory_fail "--pnpm-cli requires one absolute path and may be supplied once"
      fi
      factory_pnpm_cli_input="$2"
      shift 2
      ;;
    --)
      factory_saw_separator=true
      shift
      break
      ;;
    *)
      factory_fail "unknown launcher argument before --: $1"
      ;;
  esac
done
if [ "$factory_saw_separator" = false ]; then
  factory_fail "missing -- before render arguments"
fi
if [ "$factory_verify_only" = false ] && [ "$#" -lt 1 ]; then
  factory_fail "an absolute config path is required"
fi
if [ "$factory_verify_only" = false ] && {
  [ -z "$factory_node_input" ] || [ -z "$factory_pnpm_cli_input" ];
}; then
  factory_fail "render mode requires explicit --node-bin and --pnpm-cli toolchain paths"
fi

case "$factory_commit_input" in
  *[!0-9a-f]*|"")
    factory_fail "commit must be one full lowercase hexadecimal object ID"
    ;;
esac
if [ "${#factory_commit_input}" -ne 40 ] && [ "${#factory_commit_input}" -ne 64 ]; then
  factory_fail "commit must be one full lowercase hexadecimal object ID"
fi

factory_require_tool_file() {
  factory_tool_input="$1"
  factory_tool_label="$2"
  factory_tool_executable="$3"
  case "$factory_tool_input" in
    /*) ;;
    *) factory_fail "$factory_tool_label path must be absolute" ;;
  esac
  factory_tool_path="$(/usr/bin/realpath -e -- "$factory_tool_input")"
  if [ "$factory_tool_path" != "$factory_tool_input" ]; then
    factory_fail "$factory_tool_label path must already be canonical"
  fi
  if [ -L "$factory_tool_path" ] || [ ! -f "$factory_tool_path" ]; then
    factory_fail "$factory_tool_label must be a regular file"
  fi
  if [ "$factory_tool_executable" = true ] && [ ! -x "$factory_tool_path" ]; then
    factory_fail "$factory_tool_label must be executable"
  fi
  factory_tool_owner="$(/usr/bin/stat -c '%u' -- "$factory_tool_path")"
  if [ "$factory_tool_label" = "Node binary" ]; then
    if [ "$factory_tool_owner" -ne 0 ]; then
      factory_fail "Node binary must be root-owned"
    fi
  elif [ "$factory_tool_owner" -ne 0 ] && [ "$factory_tool_owner" -ne "$EUID" ]; then
    factory_fail "$factory_tool_label must be owned by root or the rendering user"
  fi
  factory_tool_permissions="$(/usr/bin/stat -c '%a' -- "$factory_tool_path")"
  if (( (8#$factory_tool_permissions & 0022) != 0 )); then
    factory_fail "$factory_tool_label must not be group- or world-writable"
  fi
  if [ "$factory_tool_label" = "Node binary" ]; then
    factory_tool_parent="$(/usr/bin/dirname -- "$factory_tool_path")"
    while true; do
      factory_tool_parent_owner="$(/usr/bin/stat -c '%u' -- "$factory_tool_parent")"
      factory_tool_parent_permissions="$(/usr/bin/stat -c '%a' -- "$factory_tool_parent")"
      if
        [ "$factory_tool_parent_owner" -ne 0 ] ||
        (( (8#$factory_tool_parent_permissions & 0022) != 0 ))
      then
        factory_fail \
          "Node binary ancestors must be root-owned without group/world write: $factory_tool_parent"
      fi
      [ "$factory_tool_parent" = "/" ] && break
      factory_tool_parent="$(/usr/bin/dirname -- "$factory_tool_parent")"
    done
  fi
  printf '%s\n' "$factory_tool_path"
}

factory_node_bin=""
factory_pnpm_cli=""
factory_node_sha256=""
factory_pnpm_cli_sha256=""

factory_verify_toolchain() {
  if [ "$(
    /usr/bin/sha256sum -- "$factory_node_bin" | {
      read -r factory_hash _
      printf '%s\n' "$factory_hash"
    }
  )" != "$factory_node_sha256" ]; then
    factory_fail "Node binary changed during the source-attested render"
  fi
  if [ "$(
    /usr/bin/sha256sum -- "$factory_pnpm_cli" | {
      read -r factory_hash _
      printf '%s\n' "$factory_hash"
    }
  )" != "$factory_pnpm_cli_sha256" ]; then
    factory_fail "pnpm CLI changed during the source-attested render"
  fi
}

factory_repo_root="$(/usr/bin/realpath -e -- "$factory_repo_input")"
factory_discovered_root="$(
  factory_git -C "$factory_repo_root" rev-parse --show-toplevel
)"
factory_discovered_root="$(/usr/bin/realpath -e -- "$factory_discovered_root")"
if [ "$factory_discovered_root" != "$factory_repo_root" ]; then
  factory_fail "repo-root must name the exact Git worktree root"
fi
factory_commit="$(
  factory_git -C "$factory_repo_root" rev-parse \
    --verify --end-of-options "${factory_commit_input}^{commit}"
)"
if [ "$factory_commit" != "$factory_commit_input" ]; then
  factory_fail "commit did not resolve to the exact supplied full object ID"
fi
factory_git -C "$factory_repo_root" cat-file -e \
  "${factory_commit}:scripts/run-source-attested-render.sh"

factory_snapshot_parent="$(
  /usr/bin/mktemp -d /tmp/agent-demo-video-source-snapshot.XXXXXXXX
)"
/usr/bin/chmod 0700 -- "$factory_snapshot_parent"
factory_snapshot_root="$factory_snapshot_parent/source"
factory_snapshot_added=false

factory_cleanup() {
  factory_status=$?
  trap - EXIT HUP INT TERM
  factory_cleanup_failed=false
  if [ "$factory_snapshot_added" = true ]; then
    if ! /usr/bin/chmod -R u+w -- "$factory_snapshot_root"; then
      echo "source-attested render cleanup could not make the snapshot removable: $factory_snapshot_root" >&2
      factory_cleanup_failed=true
    fi
    if ! factory_git -C "$factory_repo_root" worktree remove --force \
      "$factory_snapshot_root"; then
      echo "source-attested render cleanup could not unregister the snapshot worktree: $factory_snapshot_root" >&2
      factory_cleanup_failed=true
    fi
  fi
  if ! /usr/bin/rmdir -- "$factory_snapshot_parent"; then
    echo "source-attested render cleanup could not remove the snapshot parent: $factory_snapshot_parent" >&2
    factory_cleanup_failed=true
  fi
  if [ "$factory_cleanup_failed" = true ]; then
    if [ -e "$factory_snapshot_root" ] || [ -L "$factory_snapshot_root" ]; then
      echo "source-attested render cleanup failed; retained snapshot: $factory_snapshot_root" >&2
    elif [ -e "$factory_snapshot_parent" ] || [ -L "$factory_snapshot_parent" ]; then
      echo "source-attested render cleanup failed; retained snapshot parent: $factory_snapshot_parent" >&2
    else
      echo "source-attested render cleanup failed after removing the snapshot paths" >&2
    fi
    if [ "$factory_status" -eq 0 ]; then
      factory_status=74
    fi
  fi
  exit "$factory_status"
}
trap factory_cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

factory_git -C "$factory_repo_root" worktree add --detach --no-checkout \
  "$factory_snapshot_root" "$factory_commit" >/dev/null
factory_snapshot_added=true
factory_git -C "$factory_repo_root" archive --format=tar "$factory_commit" |
  /usr/bin/tar -xf - -C "$factory_snapshot_root"
factory_git -C "$factory_snapshot_root" read-tree "$factory_commit"
if [ "$(
  factory_git -C "$factory_snapshot_root" rev-parse --verify HEAD
)" != "$factory_commit" ]; then
  factory_fail "detached source snapshot resolved to the wrong commit"
fi
if [ "$(
  factory_git -C "$factory_snapshot_root" rev-parse --abbrev-ref HEAD
)" != "HEAD" ]; then
  factory_fail "source snapshot is not detached"
fi

declare -A factory_expected_modes=()
declare -A factory_expected_objects=()
factory_expected_count=0
while IFS= read -r -d '' factory_tree_entry; do
  factory_tree_header="${factory_tree_entry%%$'\t'*}"
  factory_tree_path="${factory_tree_entry#*$'\t'}"
  read -r factory_tree_mode factory_tree_type factory_tree_object \
    <<< "$factory_tree_header"
  if [ "$factory_tree_type" != "blob" ]; then
    factory_fail "unsupported scoped Git object: $factory_tree_path"
  fi
  case "$factory_tree_mode" in
    100644|100755) ;;
    *) factory_fail "unsupported scoped Git mode $factory_tree_mode: $factory_tree_path" ;;
  esac
  case "$factory_tree_path" in
    /*|../*|*/../*|*/..)
      factory_fail "unsafe scoped Git path: $factory_tree_path"
      ;;
  esac
  if [ -n "${factory_expected_modes[$factory_tree_path]+present}" ]; then
    factory_fail "duplicate scoped Git path: $factory_tree_path"
  fi
  factory_expected_modes["$factory_tree_path"]="$factory_tree_mode"
  factory_expected_objects["$factory_tree_path"]="$factory_tree_object"
  factory_expected_count=$((factory_expected_count + 1))
done < <(
  factory_git -C "$factory_repo_root" ls-tree -r -z "$factory_commit" -- \
    src \
    scripts/remote-entry.ts \
    scripts/run-source-attested-render.sh \
    package.json \
    pnpm-lock.yaml \
    tsconfig.json
)
if [ "$factory_expected_count" -lt 6 ]; then
  factory_fail "fixed commit is missing the source-build scope"
fi

factory_verify_file() {
  factory_absolute_path="$1"
  factory_relative_path="${factory_absolute_path#"$factory_snapshot_root/"}"
  if [ -z "${factory_expected_modes[$factory_relative_path]+present}" ]; then
    factory_fail "unexpected file in source-build scope: $factory_relative_path"
  fi
  if [ -L "$factory_absolute_path" ] || [ ! -f "$factory_absolute_path" ]; then
    factory_fail "scoped source must be a regular file: $factory_relative_path"
  fi
  if [ "$(/usr/bin/stat -c '%h' -- "$factory_absolute_path")" -ne 1 ]; then
    factory_fail "scoped source must have one hard link: $factory_relative_path"
  fi
  factory_actual_object="$(
    factory_git -C "$factory_repo_root" hash-object --no-filters -- \
      "$factory_absolute_path"
  )"
  if [ "$factory_actual_object" != "${factory_expected_objects[$factory_relative_path]}" ]; then
    factory_fail "scoped source bytes differ from commit: $factory_relative_path"
  fi
  factory_actual_permissions="$(/usr/bin/stat -c '%a' -- "$factory_absolute_path")"
  factory_actual_exec=$((8#$factory_actual_permissions & 0111))
  case "${factory_expected_modes[$factory_relative_path]}" in
    100644)
      if [ "$factory_actual_exec" -ne 0 ]; then
        factory_fail "scoped source executable mode differs from commit: $factory_relative_path"
      fi
      ;;
    100755)
      if [ "$factory_actual_exec" -ne 73 ]; then
        factory_fail "scoped source executable mode differs from commit: $factory_relative_path"
      fi
      ;;
  esac
  factory_seen_count=$((factory_seen_count + 1))
}

factory_verify_snapshot() {
  factory_seen_count=0
  while IFS= read -r -d '' factory_actual_path; do
    if [ -d "$factory_actual_path" ] && [ ! -L "$factory_actual_path" ]; then
      continue
    fi
    factory_verify_file "$factory_actual_path"
  done < <(
    /usr/bin/find \
      "$factory_snapshot_root/src" \
      "$factory_snapshot_root/scripts/remote-entry.ts" \
      "$factory_snapshot_root/scripts/run-source-attested-render.sh" \
      "$factory_snapshot_root/package.json" \
      "$factory_snapshot_root/pnpm-lock.yaml" \
      "$factory_snapshot_root/tsconfig.json" \
      -print0
  )
  if [ "$factory_seen_count" -ne "$factory_expected_count" ]; then
    factory_fail "source-build scope is missing one or more committed files"
  fi
}

factory_verify_snapshot
if [ "$factory_verify_only" = true ]; then
  /usr/bin/chmod -R a-w -- "$factory_snapshot_root/src"
  /usr/bin/chmod a-w -- \
    "$factory_snapshot_root" \
    "$factory_snapshot_root/scripts" \
    "$factory_snapshot_root/scripts/remote-entry.ts" \
    "$factory_snapshot_root/scripts/run-source-attested-render.sh" \
    "$factory_snapshot_root/package.json" \
    "$factory_snapshot_root/pnpm-lock.yaml" \
    "$factory_snapshot_root/tsconfig.json"
  factory_verify_snapshot
  printf 'verified committed source snapshot %s\n' "$factory_commit"
  exit 0
fi

factory_node_bin="$(
  factory_require_tool_file "$factory_node_input" "Node binary" true
)"
factory_pnpm_cli="$(
  factory_require_tool_file "$factory_pnpm_cli_input" "pnpm CLI" false
)"
factory_node_sha256="$(
  /usr/bin/sha256sum -- "$factory_node_bin" | {
    read -r factory_hash _
    printf '%s\n' "$factory_hash"
  }
)"
factory_pnpm_cli_sha256="$(
  /usr/bin/sha256sum -- "$factory_pnpm_cli" | {
    read -r factory_hash _
    printf '%s\n' "$factory_hash"
  }
)"

factory_config_path="$1"
case "$factory_config_path" in
  /*) ;;
  *) factory_fail "config path must be absolute" ;;
esac
for factory_argument in "$@"; do
  if [ "$factory_argument" = "--attest-source-build" ]; then
    factory_fail "the committed launcher owns --attest-source-build"
  fi
  case "$factory_argument" in
    --render-host|--render-host=*)
      factory_fail "source-attested renders must remain local"
      ;;
  esac
done
factory_previous_argument=""
for factory_argument in "$@"; do
  case "$factory_previous_argument" in
    --out|--clips-dir|--script)
      case "$factory_argument" in
        /*) ;;
        *) factory_fail "$factory_previous_argument requires an absolute path" ;;
      esac
      ;;
  esac
  case "$factory_argument" in
    --out=*|--clips-dir=*|--script=*)
      factory_argument_value="${factory_argument#*=}"
      case "$factory_argument_value" in
        /*) ;;
        *) factory_fail "${factory_argument%%=*} requires an absolute path" ;;
      esac
      ;;
  esac
  factory_previous_argument="$factory_argument"
done

factory_package_home="$factory_snapshot_root/.package-home"
factory_package_config_root="$factory_snapshot_root/.package-config"
/usr/bin/mkdir --mode=0700 -- \
  "$factory_package_home" \
  "$factory_package_config_root"

(
  cd "$factory_snapshot_root"
  /usr/bin/env -i \
    PATH=/usr/bin:/bin \
    HOME="$factory_package_home" \
    XDG_CONFIG_HOME="$factory_package_config_root" \
    NPM_CONFIG_USERCONFIG=/dev/null \
    NPM_CONFIG_GLOBALCONFIG=/dev/null \
    "$factory_node_bin" "$factory_pnpm_cli" install \
    --frozen-lockfile \
    --ignore-scripts \
    --ignore-pnpmfile \
    --config.userconfig=/dev/null \
    --config.globalconfig=/dev/null \
    --store-dir="$factory_snapshot_root/.pnpm-store" \
    --prod=false
)
factory_verify_toolchain
factory_verify_snapshot
/usr/bin/chmod -R a-w -- "$factory_snapshot_root/src"
/usr/bin/chmod a-w -- \
  "$factory_snapshot_root" \
  "$factory_snapshot_root/scripts" \
  "$factory_snapshot_root/scripts/remote-entry.ts" \
  "$factory_snapshot_root/scripts/run-source-attested-render.sh" \
  "$factory_snapshot_root/package.json" \
  "$factory_snapshot_root/pnpm-lock.yaml" \
  "$factory_snapshot_root/tsconfig.json"
factory_verify_snapshot

factory_tsx_cli="$factory_snapshot_root/node_modules/tsx/dist/cli.mjs"
if [ -L "$factory_tsx_cli" ] || [ ! -f "$factory_tsx_cli" ]; then
  factory_fail "frozen dependency install did not provide the pinned tsx runner"
fi

factory_verify_toolchain
(
  cd "$factory_snapshot_root"
  AGENT_DEMO_VIDEO_SOURCE_SNAPSHOT_ROOT="$factory_snapshot_root" \
  AGENT_DEMO_VIDEO_SOURCE_AUTHORITY_REPO="$factory_repo_root" \
  AGENT_DEMO_VIDEO_SOURCE_SNAPSHOT_COMMIT="$factory_commit" \
    "$factory_node_bin" \
    "$factory_tsx_cli" \
    --tsconfig "$factory_snapshot_root/tsconfig.json" \
    "$factory_snapshot_root/src/cli.ts" \
    "$@" \
    --attest-source-build
)
