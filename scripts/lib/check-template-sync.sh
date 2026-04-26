#!/usr/bin/env bash
# Warn when in-tree workflow security gates drift from universal templates.
# Sourceable: call check_template_sync_main "$@" to run explicitly.

set -euo pipefail

CHECK_TEMPLATE_SYNC_SECURITY_KEYWORDS=(
    'merge-base --is-ancestor'
    'check-runs'
    'set -euo pipefail'
    'pull_request.base.sha'
    'AGENTLINT_RELEASE_GATE_OPT_OUT'
)

check_template_sync_repo_root() {
    local root
    if root=$(git rev-parse --show-toplevel 2>/dev/null); then
        printf '%s\n' "$root"
        return 0
    fi
    pwd -P
}

check_template_sync_script_path() {
    local input="${BASH_SOURCE[0]}"
    local dir base
    case "$input" in
        /*) ;;
        *) input="$PWD/$input" ;;
    esac
    dir=$(dirname -- "$input")
    base=$(basename -- "$input")
    dir=$(CDPATH='' cd -- "$dir" 2>/dev/null && pwd -P) || return 1
    printf '%s/%s\n' "$dir" "$base"
}

check_template_sync_abs_path() {
    local repo_root="$1"
    local path="$2"
    case "$path" in
        /*) printf '%s\n' "$path" ;;
        *) printf '%s/%s\n' "$repo_root" "$path" ;;
    esac
}

check_template_sync_display_path() {
    local repo_root="$1"
    local path="$2"
    case "$path" in
        "$repo_root"/*) printf '%s\n' "${path#"$repo_root"/}" ;;
        *) printf '%s\n' "$path" ;;
    esac
}

check_template_sync_count_keyword() {
    local keyword="$1"
    local file="$2"
    local count
    if [ ! -f "$file" ]; then
        printf '0\n'
        return 0
    fi
    count=$(grep -F -c -- "$keyword" "$file" 2>/dev/null || true)
    printf '%s\n' "${count:-0}"
}

check_template_sync_join() {
    local delimiter="$1"
    shift
    local item
    local first=1
    for item in "$@"; do
        if [ "$first" -eq 0 ]; then
            printf '%s' "$delimiter"
        fi
        printf '%s' "$item"
        first=0
    done
}

check_template_sync_warn_for_path() {
    local repo_root="$1"
    local workflow_path="$2"

    if [[ ! "$workflow_path" =~ (^|/)\.github/workflows/[^/]+\.yml$ ]]; then
        return 0
    fi

    local workflow_base workflow_abs template_abs template_display workflow_display
    workflow_base=$(basename -- "$workflow_path")
    workflow_abs=$(check_template_sync_abs_path "$repo_root" "$workflow_path")
    template_abs="$repo_root/templates/universal/$workflow_base"

    if [ ! -f "$template_abs" ]; then
        return 0
    fi

    local keyword workflow_count template_count
    local divergent=()
    for keyword in "${CHECK_TEMPLATE_SYNC_SECURITY_KEYWORDS[@]}"; do
        workflow_count=$(check_template_sync_count_keyword "$keyword" "$workflow_abs")
        template_count=$(check_template_sync_count_keyword "$keyword" "$template_abs")
        if [ "$workflow_count" -ne "$template_count" ]; then
            divergent+=("$keyword (workflow=$workflow_count, template=$template_count)")
        fi
    done

    if [ "${#divergent[@]}" -eq 0 ]; then
        return 0
    fi

    workflow_display=$(check_template_sync_display_path "$repo_root" "$workflow_abs")
    template_display=$(check_template_sync_display_path "$repo_root" "$template_abs")
    printf '::warning::Template sync drift between %s and %s: %s\n' \
        "$workflow_display" \
        "$template_display" \
        "$(check_template_sync_join ', ' "${divergent[@]}")"
}

check_template_sync_run() {
    local repo_root="$1"
    shift

    local paths=()
    local diff_output
    if [ "$#" -gt 0 ]; then
        paths=("$@")
    else
        if ! diff_output=$(git diff --cached --name-only); then
            printf 'check-template-sync: failed to read git diff --cached --name-only\n' >&2
            return 1
        fi
        if [ -z "$diff_output" ]; then
            return 0
        fi
        while IFS= read -r path; do
            paths+=("$path")
        done <<<"$diff_output"
    fi

    local path
    for path in "${paths[@]}"; do
        check_template_sync_warn_for_path "$repo_root" "$path"
    done
}

check_template_sync_self_test() {
    local fixture_root="/tmp/al-template-sync-fixture-$$"
    local script_path output
    script_path=$(check_template_sync_script_path)

    if [ -e "$fixture_root" ]; then
        printf 'Self-test fixture already exists: %s\n' "$fixture_root" >&2
        return 1
    fi

    mkdir -p "$fixture_root/.github/workflows" "$fixture_root/templates/universal"

    cat >"$fixture_root/.github/workflows/release.yml" <<'EOF'
name: release
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - run: |
          set -euo pipefail
          git merge-base --is-ancestor "$BASE_SHA" "$HEAD_SHA"
EOF

    cat >"$fixture_root/templates/universal/release.yml" <<'EOF'
name: release
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - run: |
          set -euo pipefail
EOF

    output=$(
        cd "$fixture_root"
        bash "$script_path" ".github/workflows/release.yml"
    )

    printf '%s\n' "$output"
    if [[ "$output" != *"::warning::"* ]]; then
        printf 'Self-test FAILED: expected a ::warning:: line for synthetic mismatch.\n' >&2
        return 1
    fi

    rm -rf -- "$fixture_root"
    printf 'Self-test PASSED: warning emitted for synthetic mismatch.\n'
}

check_template_sync_main() {
    if [ "${1:-}" = "--self-test" ]; then
        if [ "$#" -ne 1 ]; then
            printf 'Usage: %s [--self-test] [paths...]\n' "$0" >&2
            return 2
        fi
        check_template_sync_self_test
        return $?
    fi

    local repo_root
    repo_root=$(check_template_sync_repo_root)
    check_template_sync_run "$repo_root" "$@"
}

if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
    check_template_sync_main "$@"
fi
