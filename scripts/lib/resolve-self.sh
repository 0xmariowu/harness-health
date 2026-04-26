#!/usr/bin/env bash
# resolve_self <path>: portable BASH_SOURCE resolver. Handles absolute and
# relative symlink targets without relying on `readlink -f` (BSD/macOS lack
# it). Uses cd + pwd -P for canonicalization.

resolve_self() {
    local input="${1:-}"
    if [ -z "$input" ]; then
        return 1
    fi
    local current="$input"
    local target
    local current_dir
    local i=0
    # Resolve up to 16 symlink levels (POSIX SYMLOOP_MAX is 8; doubled here).
    while [ -L "$current" ] && [ "$i" -lt 16 ]; do
        target=$(readlink "$current")
        case "$target" in
            /*) current="$target" ;;
            *)
                current_dir=$(dirname "$current")
                current="$current_dir/$target"
                ;;
        esac
        i=$((i + 1))
    done
    local final_dir final_base
    final_dir=$(dirname "$current")
    final_base=$(basename "$current")
    final_dir=$(CDPATH='' cd -- "$final_dir" 2>/dev/null && pwd -P) || return 1
    if [ "$final_base" = "/" ]; then
        echo "$final_dir"
    else
        echo "$final_dir/$final_base"
    fi
}
