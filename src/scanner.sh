#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "${SCRIPT_DIR}/.." && pwd)"
EVIDENCE_FILE="${REPO_ROOT}/standards/evidence.json"
THRESHOLDS_FILE="${REPO_ROOT}/standards/reference-thresholds.json"

usage() {
  cat <<'EOF' >&2
Usage: scanner.sh [--project-dir PATH]

Scans git projects for AI-friendliness and writes JSONL to stdout.

Options:
  --project-dir PATH   Scan a single project directory instead of auto-discovery
  -h, --help          Show this help
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf '%s\n' "Missing required command: $1" >&2
    exit 1
  }
}

portable_stat_mtime() {
  local path="$1"
  if stat -f %m "$path" >/dev/null 2>&1; then
    stat -f %m "$path"
  else
    stat -c %Y "$path" 2>/dev/null
  fi
}

lower_text() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

json_array() {
  if [ "$#" -eq 0 ]; then
    printf '[]'
  else
    printf '%s\n' "$@" | jq -R . | jq -s 'map(select(length > 0))'
  fi
}

count_words() {
  wc -w < "$1" | tr -d '[:space:]'
}

count_lines() {
  wc -l < "$1" | tr -d '[:space:]'
}

score_upper_bound() {
  local measured="$1"
  local reference="$2"
  awk -v measured="$measured" -v reference="$reference" '
    BEGIN {
      if (reference <= 0) {
        if (measured <= 0) print 1;
        else print 0;
      } else if (measured <= reference) {
        print 1;
      } else {
        score = reference / measured;
        if (score < 0) score = 0;
        if (score > 1) score = 1;
        print score;
      }
    }
  '
}

score_range() {
  local measured="$1"
  local low="$2"
  local high="$3"
  awk -v measured="$measured" -v low="$low" -v high="$high" '
    BEGIN {
      if (measured <= 0) {
        print 0;
      } else if (measured >= low && measured <= high) {
        print 1;
      } else if (measured < low) {
        score = measured / low;
        if (score < 0) score = 0;
        if (score > 1) score = 1;
        print score;
      } else {
        score = high / measured;
        if (score < 0) score = 0;
        if (score > 1) score = 1;
        print score;
      }
    }
  '
}

score_ratio() {
  local measured="$1"
  awk -v measured="$measured" '
    BEGIN {
      score = measured;
      if (score < 0) score = 0;
      if (score > 1) score = 1;
      print score;
    }
  '
}

score_count_presence() {
  local measured="$1"
  awk -v measured="$measured" 'BEGIN { if (measured > 0) print 1; else print 0 }'
}

is_regular_file() {
  # Return true only for regular files, NOT symlinks, directories, or special files.
  [ -f "$1" ] && [ ! -L "$1" ]
}

entry_file_rel() {
  local project_dir="$1"
  if is_regular_file "${project_dir}/CLAUDE.md"; then
    printf '%s\n' "CLAUDE.md"
  elif is_regular_file "${project_dir}/AGENTS.md"; then
    printf '%s\n' "AGENTS.md"
  elif is_regular_file "${project_dir}/.cursorrules"; then
    printf '%s\n' ".cursorrules"
  elif is_regular_file "${project_dir}/.github/copilot-instructions.md"; then
    printf '%s\n' ".github/copilot-instructions.md"
  elif is_regular_file "${project_dir}/GEMINI.md"; then
    printf '%s\n' "GEMINI.md"
  elif is_regular_file "${project_dir}/.windsurfrules"; then
    printf '%s\n' ".windsurfrules"
  elif is_regular_file "${project_dir}/.clinerules"; then
    printf '%s\n' ".clinerules"
  elif [ -d "${project_dir}/.cursor/rules" ] && [ ! -L "${project_dir}/.cursor/rules" ]; then
    local mdc_file=""
    local candidate=""
    for candidate in "${project_dir}/.cursor/rules/"*.mdc; do
      is_regular_file "$candidate" || continue
      mdc_file="$candidate"
      break
    done
    if [ -n "$mdc_file" ]; then
      printf '%s\n' ".cursor/rules/$(basename "$mdc_file")"
    else
      printf '\n'
    fi
  else
    printf '\n'
  fi
}

entry_platform() {
  local entry_rel="$1"
  case "$entry_rel" in
    CLAUDE.md)                       printf 'claude\n' ;;
    AGENTS.md)                       printf 'openai\n' ;;
    .cursorrules)                    printf 'cursor\n' ;;
    .github/copilot-instructions.md) printf 'copilot\n' ;;
    GEMINI.md)                       printf 'gemini\n' ;;
    .windsurfrules)                  printf 'windsurf\n' ;;
    .clinerules)                     printf 'cline\n' ;;
    .cursor/rules/*)                 printf 'cursor-mdc\n' ;;
    *)                               printf 'unknown\n' ;;
  esac
}

detect_all_platform_files() {
  local project_dir="$1"
  local files=()
  [ -f "${project_dir}/CLAUDE.md" ] && files+=("CLAUDE.md")
  [ -f "${project_dir}/AGENTS.md" ] && files+=("AGENTS.md")
  [ -f "${project_dir}/.cursorrules" ] && files+=(".cursorrules")
  [ -f "${project_dir}/.github/copilot-instructions.md" ] && files+=(".github/copilot-instructions.md")
  [ -f "${project_dir}/GEMINI.md" ] && files+=("GEMINI.md")
  [ -f "${project_dir}/.windsurfrules" ] && files+=(".windsurfrules")
  [ -f "${project_dir}/.clinerules" ] && files+=(".clinerules")
  ls "${project_dir}/.cursor/rules/"*.mdc >/dev/null 2>&1 && files+=(".cursor/rules/*.mdc")
  if [ "${#files[@]}" -gt 0 ]; then
    json_array "${files[@]}"
  else
    printf '[]\n'
  fi
}

find_index_files() {
  local project_dir="$1"
  find "$project_dir" -maxdepth 1 -type f \
    \( -name 'INDEX' -o -name 'INDEX.*' -o -name 'index' -o -name 'index.*' \) \
    2>/dev/null | while IFS= read -r file; do
      basename "$file"
    done | sort -u
}

has_project_description() {
  local entry_file="$1"
  local line=""
  local trimmed=""
  local count=0

  while IFS= read -r line || [ -n "$line" ]; do
    count=$((count + 1))
    [ "$count" -gt 10 ] && break

    trimmed="$(printf '%s' "$line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -z "$trimmed" ] && continue

    case "$trimmed" in
      '##'*) break ;;
      '# '*|'#	'*) continue ;;
      '>'*) return 0 ;;
      '- '*|'* '*|'```'*|'1. '*|'2. '*|'3. '*|'4. '*|'5. '*|'6. '*|'7. '*|'8. '*|'9. '*) continue ;;
      *) return 0 ;;
    esac
  done < "$entry_file"

  return 1
}

normalize_reference() {
  local raw="$1"
  printf '%s' "$raw" | \
    sed -E 's/^[[:space:]`"'\''(<\[]+//; s/[[:space:]`"'\''>)\].,;:]+$//; s/[?#].*$//'
}

should_skip_reference() {
  local ref="$1"

  [ -z "$ref" ] && return 0

  if [[ "$ref" == http://* || "$ref" == https://* || "$ref" == mailto:* || "$ref" == \#* ]]; then
    return 0
  fi

  if [[ "$ref" == *'{'* || "$ref" == *'}'* ]]; then
    return 0
  fi

  if [[ "$ref" == 'feature/*' || "$ref" == 'fix/*' || "$ref" == 'chore/*' ]]; then
    return 0
  fi

  if [[ "$ref" =~ ^/[A-Za-z0-9_-]+$ ]]; then
    return 0
  fi

  # Skip common rule-text fragments that look like paths but aren't
  case "$ref" in
    .env*|__pycache__*|node_modules*|.git/*)
      return 0 ;;
    *'`'*|*')'*|*'('*|-A*|-a*|--*|*.md,*|*.,)
      return 0 ;;
  esac

  # Skip shell commands (contain spaces or known command prefixes)
  if [[ "$ref" == *" "* ]]; then
    return 0
  fi

  # Skip slash-separated lists (feat/fix/refactor/..., winning/losing)
  local slash_count="${ref//[^\/]/}"
  if [ "${#slash_count}" -ge 3 ] && [[ ! "$ref" == *"."* ]]; then
    # 3+ slashes and no file extension = probably a list, not a path
    return 0
  fi

  # Skip pure numeric fragments and version patterns (0.6, 10., 12., 3.11+, v2)
  if [[ "$ref" =~ ^[0-9]+\.?[0-9]*\+?$ ]]; then
    return 0
  fi
  if [[ "$ref" =~ ^v[0-9] ]]; then
    return 0
  fi

  # Skip very short fragments (likely not real paths)
  if [ "${#ref}" -le 2 ]; then
    return 0
  fi

  # Skip glob patterns (*.json, *.md, platforms/*.md, genome/defaults/*.json)
  if [[ "$ref" == *'*'* ]]; then
    return 0
  fi

  # Skip external paths that reference outside the project
  # shellcheck disable=SC2088
  case "$ref" in
    "~/"*|"/Volumes/"*)
      return 0 ;;
  esac

  # Skip words ending with punctuation (sentences, not paths)
  case "$ref" in
    *.|*,|*\;|*:|*\)|*\"|*\')
      return 0 ;;
  esac

  # Skip known non-path words that contain dots or slashes
  case "$ref" in
    Node.js|node.js|Python.*|Java.*|TypeScript|Go.*|Rust.*)
      return 0 ;;
  esac

  # Skip percentage patterns (1.9%, 51.6%)
  if [[ "$ref" =~ ^[0-9]+\.[0-9]+% ]]; then
    return 0
  fi

  return 1
}

looks_like_reference() {
  local ref="$1"

  if should_skip_reference "$ref"; then
    return 1
  fi

  case "$ref" in
    ./*|../*|/*) return 0 ;;
    */*) return 0 ;;
    .[A-Za-z0-9_-]*|*.*) return 0 ;;
  esac

  return 1
}

extract_references() {
  local entry_file="$1"
  local line=""
  local rest=""
  local candidate=""
  local md_link_regex='\[[^][]+\]\(([^)]+)\)'

  local in_fenced_block=false

  while IFS= read -r line || [ -n "$line" ]; do
    # Track fenced code blocks (``` or ~~~)
    case "$line" in
      '```'*|'~~~'*)
        if [ "$in_fenced_block" = true ]; then
          in_fenced_block=false
        else
          in_fenced_block=true
        fi
        continue
        ;;
    esac

    # Skip lines inside fenced code blocks
    [ "$in_fenced_block" = true ] && continue

    # Skip indented code blocks (4+ spaces or tab)
    case "$line" in
      '    '*|'	'*) continue ;;
    esac

    # Only extract references from markdown links [text](path)
    # Skip inline code, bare paths in prose, and list items with paths as descriptions
    rest="$line"
    while [[ "$rest" =~ $md_link_regex ]]; do
      # Cache match groups before calling helpers — normalize_reference
      # and looks_like_reference invoke their own [[ =~ ]] which resets
      # BASH_REMATCH, and `set -u` at file top would then fail on [0]/[1].
      local match0="${BASH_REMATCH[0]}"
      local match1="${BASH_REMATCH[1]}"
      candidate="$(normalize_reference "$match1")"
      if looks_like_reference "$candidate"; then
        printf '%s\n' "$candidate"
      fi
      rest="${rest#*"$match0"}"
    done
  done < "$entry_file" | sort -u
}

resolve_reference_exists() {
  local project_dir="$1"
  local ref="$2"

  if [ -z "$ref" ]; then
    return 1
  fi

  # Skip absolute paths — don't probe filesystem outside project
  if [[ "$ref" == /* ]]; then
    return 1
  fi

  # Reject parent-dir traversal. "/${ref}/" wraps the ref so leading,
  # trailing, and middle "../" segments all match the same check.
  case "/${ref}/" in
    *"/../"*) return 1 ;;
  esac

  # Check only within project_dir. Do NOT probe the shell's CWD or
  # absolute paths — that would let ../../../etc/passwd resolve if
  # the check were run from /.
  if [ -e "${project_dir}/${ref#./}" ]; then
    return 0
  fi

  # Escape glob characters for find -name
  local safe_ref="${ref//\[/\\[}"
  safe_ref="${safe_ref//\]/\\]}"
  safe_ref="${safe_ref//\*/\\*}"
  safe_ref="${safe_ref//\?/\\?}"

  # For bare filenames (no /), search subdirectories by name
  if [[ "$ref" != */* ]] && [[ "$ref" == *.* ]]; then
    if find "$project_dir" -maxdepth 4 -name "$safe_ref" -print -quit 2>/dev/null | grep -q .; then
      return 0
    fi
  fi

  # For relative paths with /, try matching the last component
  if [[ "$ref" == */* ]] && [[ "$ref" != /* ]]; then
    local basename="${ref##*/}"
    local safe_basename="${basename//\[/\\[}"
    safe_basename="${safe_basename//\]/\\]}"
    safe_basename="${safe_basename//\*/\\*}"
    safe_basename="${safe_basename//\?/\\?}"
    if [ -n "$basename" ] && [[ "$basename" == *.* ]]; then
      if find "$project_dir" -maxdepth 4 -name "$safe_basename" -print -quit 2>/dev/null | grep -q .; then
        return 0
      fi
    fi
    # Also try the last directory component as a directory name
    local dirname="${ref%%/*}"
    local safe_dirname="${dirname//\[/\\[}"
    safe_dirname="${safe_dirname//\]/\\]}"
    safe_dirname="${safe_dirname//\*/\\*}"
    safe_dirname="${safe_dirname//\?/\\?}"
    if find "$project_dir" -maxdepth 3 -type d -name "$safe_dirname" -print -quit 2>/dev/null | grep -q .; then
      return 0
    fi
  fi

  return 1
}

extract_command_matches() {
  local entry_file="$1"
  local contents=""
  local -a commands=()

  contents="$(lower_text "$(cat "$entry_file")")"

  case "$contents" in *"npm test"*) commands[${#commands[@]}]="npm test" ;; esac
  case "$contents" in *"pnpm test"*) commands[${#commands[@]}]="pnpm test" ;; esac
  case "$contents" in *"yarn test"*) commands[${#commands[@]}]="yarn test" ;; esac
  case "$contents" in *"bun test"*) commands[${#commands[@]}]="bun test" ;; esac
  case "$contents" in *"pytest"*) commands[${#commands[@]}]="pytest" ;; esac
  case "$contents" in *"uv run pytest"*) commands[${#commands[@]}]="uv run pytest" ;; esac
  case "$contents" in *"make test"*) commands[${#commands[@]}]="make test" ;; esac
  case "$contents" in *"make build"*) commands[${#commands[@]}]="make build" ;; esac
  case "$contents" in *"cargo test"*) commands[${#commands[@]}]="cargo test" ;; esac
  case "$contents" in *"cargo build"*) commands[${#commands[@]}]="cargo build" ;; esac
  case "$contents" in *"go test"*) commands[${#commands[@]}]="go test" ;; esac
  case "$contents" in *"go build"*) commands[${#commands[@]}]="go build" ;; esac
  case "$contents" in *"npm run build"*) commands[${#commands[@]}]="npm run build" ;; esac
  case "$contents" in *"pnpm build"*) commands[${#commands[@]}]="pnpm build" ;; esac
  case "$contents" in *"yarn build"*) commands[${#commands[@]}]="yarn build" ;; esac
  case "$contents" in *"bun run build"*) commands[${#commands[@]}]="bun run build" ;; esac
  case "$contents" in *"tox"*) commands[${#commands[@]}]="tox" ;; esac
  case "$contents" in *"just test"*) commands[${#commands[@]}]="just test" ;; esac

  if [ "${#commands[@]}" -eq 0 ]; then
    printf '[]'
  else
    printf '%s\n' "${commands[@]}" | sort -u | jq -R . | jq -s '.'
  fi
}

workflow_count() {
  local project_dir="$1"
  local count=0

  if [ -d "${project_dir}/.github/workflows" ]; then
    count="$(find "${project_dir}/.github/workflows" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null | wc -l | tr -d '[:space:]')"
    printf '%s\n' "$count"
  else
    printf '%s\n' "0"
  fi
}

test_file_count() {
  local project_dir="$1"
  find "$project_dir" -type f \
    -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/__pycache__/*' \
    -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/vendor/*' \
    2>/dev/null | while IFS= read -r file; do
    case "$file" in
      */tests/*|*/test/*|*/__tests__/*|*/spec/*|*.test.*|*.spec.*) printf '%s\n' "$file" ;;
    esac
  done | sort -u | wc -l | tr -d '[:space:]'
}

linter_configs_json() {
  local project_dir="$1"
  local -a found=()
  local file=""

  while IFS= read -r file; do
    [ -z "$file" ] && continue
    found[${#found[@]}]="$(basename "$file")"
  done <<EOF
$(find "$project_dir" -maxdepth 1 -type f \( -name 'eslint*' -o -name '.eslint*' -o -name '.prettierrc*' -o -name 'pyrightconfig*' -o -name '.rubocop*' -o -name '.golangci*' \) 2>/dev/null | sort -u)
EOF

  if [ -f "${project_dir}/pyproject.toml" ] && grep -q '^\[tool\.ruff\]' "${project_dir}/pyproject.toml" 2>/dev/null; then
    found[${#found[@]}]="pyproject.toml[tool.ruff]"
  fi

  if [ "${#found[@]}" -eq 0 ]; then
    printf '[]'
  else
    printf '%s\n' "${found[@]}" | sort -u | jq -R . | jq -s '.'
  fi
}

git_code_timestamp() {
  local project_dir="$1"
  git -C "$project_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
  git -C "$project_dir" log -1 --format=%ct -- \
    ':(glob)**/*.sh' ':(glob)**/*.bash' ':(glob)**/*.zsh' \
    ':(glob)**/*.js' ':(glob)**/*.jsx' ':(glob)**/*.ts' ':(glob)**/*.tsx' \
    ':(glob)**/*.py' ':(glob)**/*.rb' ':(glob)**/*.go' ':(glob)**/*.rs' \
    ':(glob)**/*.java' ':(glob)**/*.kt' ':(glob)**/*.swift' ':(glob)**/*.c' \
    ':(glob)**/*.cc' ':(glob)**/*.cpp' ':(glob)**/*.h' ':(glob)**/*.hpp' \
    ':(glob)**/*.cs' ':(glob)**/*.php' ':(glob)**/*.m' ':(glob)**/*.mm' \
    ':(glob)**/*.scala' ':(glob)**/*.sql' 2>/dev/null
}

filesystem_code_timestamp() {
  local project_dir="$1"
  local newest=0
  local file=""
  local ts=0

  # Use stat on batched results instead of per-file subprocess
  local code_files
  code_files="$(find "$project_dir" -type f \
    -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/__pycache__/*' \
    -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/vendor/*' \
    -not -path '*/docs/*' -not -path '*/standards/*' \
    \( -name '*.sh' -o -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' \
       -o -name '*.py' -o -name '*.rb' -o -name '*.go' -o -name '*.rs' \
       -o -name '*.java' -o -name '*.kt' -o -name '*.swift' -o -name '*.c' \
       -o -name '*.cc' -o -name '*.cpp' -o -name '*.h' -o -name '*.hpp' \
       -o -name '*.cs' -o -name '*.php' -o -name '*.scala' -o -name '*.sql' \) \
    2>/dev/null)"
  if [ -n "$code_files" ]; then
    # Use stat with multiple files at once (macOS stat -f %m)
    newest="$(printf '%s\n' "$code_files" | head -500 | while IFS= read -r file; do
      portable_stat_mtime "$file" 2>/dev/null
    done | sort -rn | head -1)"
    newest="${newest:-0}"
  fi

  printf '%s\n' "$newest"
}

entry_timestamp() {
  local project_dir="$1"
  local entry_rel="$2"
  local ts=""

  if git -C "$project_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    ts="$(git -C "$project_dir" log -1 --format=%ct -- "$entry_rel" 2>/dev/null)"
    if [ -n "$ts" ]; then
      printf '%s\n' "$ts"
      return 0
    fi
  fi

  portable_stat_mtime "${project_dir}/${entry_rel}"
}

emit_result() {
  local project_name="$1"
  local check_id="$2"
  local measured_json="$3"
  local reference_json="$4"
  local score_json="$5"
  local detail="$6"
  local dimension=""
  local check_name=""
  local line=""

  dimension="$(jq -r --arg id "$check_id" '.checks[$id].dimension // empty' "$EVIDENCE_FILE")"
  check_name="$(jq -r --arg id "$check_id" '.checks[$id].name // empty' "$EVIDENCE_FILE")"

  if [ -z "$dimension" ] || [ -z "$check_name" ]; then
    printf 'scanner error: unknown check_id "%s" — not in evidence.json\n' "$check_id" >&2
    return 1
  fi

  line="$(jq -cn \
    --arg project "$project_name" \
    --arg dimension "$dimension" \
    --arg check_id "$check_id" \
    --arg name "$check_name" \
    --arg detail "$detail" \
    --arg evidence_id "$check_id" \
    --argjson measured_value "$measured_json" \
    --argjson reference_value "$reference_json" \
    --argjson score "$score_json" \
    '{
      project: $project,
      dimension: $dimension,
      check_id: $check_id,
      name: $name,
      measured_value: $measured_value,
      reference_value: $reference_value,
      score: $score,
      detail: $detail,
      evidence_id: $evidence_id
    }')" || {
    printf 'scanner error: jq failed emitting %s for %s\n' "$check_id" "$project_name" >&2
    return 1
  }

  if [ -z "$line" ]; then
    printf 'scanner error: jq produced empty output for %s\n' "$check_id" >&2
    return 1
  fi

  printf '%s\n' "$line"
}

# Static-only: extracts a script file path from a shell command string.
# NEVER executes the script. Returns 'INLINE' for inline commands, empty
# for inline flags only, or the resolved absolute path for file refs.
extract_script_path() {
  local command_str="$1"
  local project_dir="$2"
  # Detect inline shell commands
  case "$command_str" in
    "bash -c "*|"sh -c "*|"python3 -c "*|"python -c "*|"node -e "*|"node --eval "*)
      printf 'INLINE\n'
      return
      ;;
  esac
  # Extract first non-flag, non-interpreter token as script path
  local script_path=""
  local token
  local restore_glob=0
  case $- in
    *f*) restore_glob=1 ;;
  esac
  set -f
  # shellcheck disable=SC2086
  for token in $command_str; do
    case "$token" in
      -*) continue ;;
      bash|sh|python|python3|node|zsh) continue ;;
      *)
        script_path="$token"
        break
        ;;
    esac
  done
  [ "$restore_glob" -eq 1 ] || set +f
  [ -z "$script_path" ] && return
  # Resolve relative paths against project_dir
  case "$script_path" in
    ./*) script_path="${project_dir}/${script_path#./}" ;;
    ../*) script_path="${project_dir}/${script_path}" ;;
  esac
  # Confine resolved path to project_dir — reject traversal outside repo
  local real_script real_project
  real_script="$(cd "$(dirname "$script_path")" 2>/dev/null && pwd)/$(basename "$script_path")" 2>/dev/null || return
  real_project="$(cd "$project_dir" 2>/dev/null && pwd)" 2>/dev/null || return
  case "$real_script" in
    "${real_project}"/*) ;;
    *) return ;;  # outside project — do not return path
  esac
  # Reject symlinks
  [ -L "$script_path" ] && return
  printf '%s\n' "$script_path"
}

scan_project() {
  local project_dir="$1"
  local project_name=""
  local entry_rel=""
  local entry_abs=""
  local line_count_value=0
  local score=0
  local detail=""
  local measured="null"
  local reference="null"
  local file=""
  local content_count=0
  local index_files_json='[]'
  local has_index=false
  local broken=0
  local total_refs=0
  local -a broken_refs=()
  local count_important=0
  local count_never=0
  local count_must=0
  local count_critical=0
  local word_count_value=0
  local density=0
  local dont_total=0
  local dont_with_because=0
  local i=0
  local j=0
  local ratio=0
  local action_count=0
  local identity_count=0
  local identity_language_count=0
  local commands_json='[]'
  local workflow_total=0
  local test_total=0
  local linter_json='[]'
  local code_ts=0
  local entry_ts=0
  local freshness_days=0
  local plans_json='[]'
  local handoff_found=false
  local changelog_lines=0
  local -a lines=()
  local heading=""
  local heading_lower=""
  local -a plan_dirs=()

  project_name="$(basename "$project_dir")"
  entry_rel="$(entry_file_rel "$project_dir")"

  if [ -n "$entry_rel" ]; then
    entry_abs="${project_dir}/${entry_rel}"
  else
    entry_abs=""
  fi

  local platform
  platform="$(entry_platform "$entry_rel")"
  local all_platform_files
  all_platform_files="$(detect_all_platform_files "$project_dir")"

  # F1 — entry file exists (multi-platform)
  if [ -n "$entry_rel" ]; then
    local f1_measured
    f1_measured="$(jq -cn --arg entry "$entry_rel" --arg platform "$platform" --argjson all "$all_platform_files" \
      '{entry_file: $entry, platform: $platform, all_files: $all}')"
    emit_result "$project_name" "F1" "$f1_measured" "null" "1" "Entry file: ${entry_rel} (${platform})"
  else
    emit_result "$project_name" "F1" '{"entry_file":null,"platform":null,"all_files":[]}' "null" "0" "No entry file found (checked CLAUDE.md, AGENTS.md, .cursorrules, .github/copilot-instructions.md, GEMINI.md, .windsurfrules, .clinerules, .cursor/rules/*.mdc)"
  fi

  # F2
  if [ -n "$entry_abs" ] && has_project_description "$entry_abs"; then
    emit_result "$project_name" "F2" "true" "null" "1" "Description found in first 10 lines of ${entry_rel}"
  else
    emit_result "$project_name" "F2" "false" "null" "0" "No project description detected in the first 10 lines"
  fi

  # F3
  if [ -n "$entry_abs" ] && grep -Eiq 'if.*read|Session Checklist|checklist' "$entry_abs" 2>/dev/null; then
    emit_result "$project_name" "F3" "true" "null" "1" "Conditional loading guidance found in ${entry_rel}"
  else
    emit_result "$project_name" "F3" "false" "null" "0" "No conditional loading guidance found"
  fi

  # F4
  content_count="$(find "$project_dir" -maxdepth 1 -type f ! -name '.*' ! -name 'node_modules' ! -name '__pycache__' 2>/dev/null | wc -l | tr -d '[:space:]')"
  content_count="${content_count:-0}"
  index_files_json="$(find_index_files "$project_dir" | jq -R . | jq -s '.')"
  has_index=false
  if [ "$index_files_json" != "[]" ]; then
    has_index=true
  fi
  measured="$(jq -cn --argjson cc "${content_count}" --argjson hi "${has_index}" --argjson ix "$index_files_json" '{content_files: $cc, has_index: $hi, index_files: $ix}')"
  reference="$(jq -c '.F4_index_threshold.reference' "$THRESHOLDS_FILE")"
  if [ "$content_count" -le 10 ] || [ "$has_index" = true ]; then
    score="1"
    detail="Root has ${content_count} content files; index present: ${has_index}"
  else
    score="0"
    detail="Root has ${content_count} content files and no INDEX file"
  fi
  emit_result "$project_name" "F4" "$measured" "$reference" "$score" "$detail"

  # F5
  if [ -n "$entry_abs" ]; then
    while IFS= read -r file; do
      [ -z "$file" ] && continue
      total_refs=$((total_refs + 1))
      if ! resolve_reference_exists "$project_dir" "$file"; then
        broken=$((broken + 1))
        if [ "${#broken_refs[@]}" -lt 5 ]; then
          broken_refs[${#broken_refs[@]}]="$file"
        fi
      fi
    done <<EOF
$(extract_references "$entry_abs")
EOF
    measured="$broken"
    reference="0"
    if [ "$broken" -eq 0 ]; then
      score="1"
      detail="All ${total_refs} extracted references resolve"
    else
      score="0"
      detail="Broken references: ${broken}/${total_refs}. Examples: $(printf '%s, ' "${broken_refs[@]}" | sed 's/, $//')"
    fi
  else
    measured="0"
    reference="0"
    score="0"
    detail="Skipped because no entry file exists"
  fi
  emit_result "$project_name" "F5" "$measured" "$reference" "$score" "$detail"

  # F6
  measured="$(jq -cn \
    --argjson readme "$( [ -f "${project_dir}/README.md" ] && printf 'true' || printf 'false' )" \
    --argjson entry_file "$( [ -n "$entry_rel" ] && printf 'true' || printf 'false' )" \
    --argjson changelog "$( [ -f "${project_dir}/CHANGELOG.md" ] && printf 'true' || printf 'false' )" \
    '{README_md: $readme, entry_file: $entry_file, CHANGELOG_md: $changelog}')"
  if [ -f "${project_dir}/README.md" ] && [ -n "$entry_rel" ] && [ -f "${project_dir}/CHANGELOG.md" ]; then
    score="1"
    detail="README.md, ${entry_rel}, and CHANGELOG.md are present"
  else
    score="0"
    detail="Missing one or more standard files among README.md, entry file, and CHANGELOG.md"
  fi
  emit_result "$project_name" "F6" "$measured" "null" "$score" "$detail"

  if [ -n "$entry_abs" ]; then
    # Strip fenced code blocks and indented code, then count keywords.
    # Uses awk streaming — no buffering of the entire file in memory.
    local keyword_counts=""
    # LC_ALL=C makes awk treat input as bytes, tolerating non-UTF-8/binary files.
    keyword_counts="$(LC_ALL=C awk '
      /^```/ || /^~~~/ { fence = !fence; next }
      fence { next }
      /^    / || /^\t/ { next }
      {
        n = split($0, words, /[^A-Za-z]+/)
        for (i = 1; i <= n; i++) {
          if (words[i] == "IMPORTANT") imp++
          else if (words[i] == "NEVER") nev++
          else if (words[i] == "MUST") mus++
          else if (words[i] == "CRITICAL") cri++
        }
      }
      END { printf "%d %d %d %d", imp+0, nev+0, mus+0, cri+0 }
    ' "$entry_abs" 2>/dev/null || printf '0 0 0 0')"
    count_important="${keyword_counts%% *}"
    keyword_counts="${keyword_counts#* }"
    count_never="${keyword_counts%% *}"
    keyword_counts="${keyword_counts#* }"
    count_must="${keyword_counts%% *}"
    count_critical="${keyword_counts#* }"
    measured="$(jq -cn \
      --argjson IMPORTANT "$count_important" \
      --argjson NEVER "$count_never" \
      --argjson MUST "$count_must" \
      --argjson CRITICAL "$count_critical" \
      '{IMPORTANT: $IMPORTANT, NEVER: $NEVER, MUST: $MUST, CRITICAL: $CRITICAL}')"
    reference="$(jq -c '.I1_emphasis | map_values(.reference)' "$THRESHOLDS_FILE")"
    score="$(awk \
      -v important="$count_important" \
      -v never="$count_never" \
      -v must="$count_must" \
      -v critical="$count_critical" \
      -v ref_important="$(jq -r '.I1_emphasis.IMPORTANT.reference' "$THRESHOLDS_FILE")" \
      -v ref_never="$(jq -r '.I1_emphasis.NEVER.reference' "$THRESHOLDS_FILE")" \
      -v ref_must="$(jq -r '.I1_emphasis.MUST.reference' "$THRESHOLDS_FILE")" \
      -v ref_critical="$(jq -r '.I1_emphasis.CRITICAL.reference' "$THRESHOLDS_FILE")" '
        function one_score(measured, reference) {
          if (reference <= 0) {
            return measured <= 0 ? 1 : 0
          }
          return measured <= reference ? 1 : reference / measured
        }
        BEGIN {
          total = one_score(important, ref_important) + one_score(never, ref_never) + one_score(must, ref_must) + one_score(critical, ref_critical)
          print total / 4
        }
      ')"
    detail="Keyword counts in ${entry_rel}: IMPORTANT=${count_important}, NEVER=${count_never}, MUST=${count_must}, CRITICAL=${count_critical}"
  else
    measured='{"IMPORTANT":0,"NEVER":0,"MUST":0,"CRITICAL":0}'
    reference="$(jq -c '.I1_emphasis | map_values(.reference)' "$THRESHOLDS_FILE")"
    score="0"
    detail="Skipped because no entry file exists"
  fi
  emit_result "$project_name" "I1" "$measured" "$reference" "$score" "$detail"

  # I2
  if [ -n "$entry_abs" ]; then
    word_count_value="$(count_words "$entry_abs")"
    density="$(awk -v total="$((count_important + count_never + count_must + count_critical))" -v words="$word_count_value" '
      BEGIN {
        if (words <= 0) print 0;
        else print (total / words) * 1000;
      }
    ')"
    score="$(score_upper_bound "$density" "$(jq -r '.I2_density.reference' "$THRESHOLDS_FILE")")"
    measured="$density"
    reference="$(jq -c '.I2_density.reference' "$THRESHOLDS_FILE")"
    detail="Emphasis density is ${density} keywords per 1K words across ${word_count_value} words"
  else
    measured="0"
    reference="$(jq -c '.I2_density.reference' "$THRESHOLDS_FILE")"
    score="0"
    detail="Skipped because no entry file exists"
  fi
  emit_result "$project_name" "I2" "$measured" "$reference" "$score" "$detail"

  # I3
  if [ -n "$entry_abs" ]; then
    i=0
    while IFS= read -r file || [ -n "$file" ]; do
      lines[i]="$file"
      i=$((i + 1))
    done < "$entry_abs"

    dont_total=0
    dont_with_because=0
    for ((i = 0; i < ${#lines[@]}; i++)); do
      if printf '%s\n' "${lines[$i]}" | grep -Eiq "^[[:space:]]*-[[:space:]]+(Don't|Do not)"; then
        dont_total=$((dont_total + 1))
        for ((j = i + 1; j <= i + 5 && j < ${#lines[@]}; j++)); do
          if printf '%s\n' "${lines[$j]}" | grep -q 'Because:'; then
            dont_with_because=$((dont_with_because + 1))
            break
          fi
        done
      fi
    done

    ratio="$(awk -v with_because="$dont_with_because" -v total="$dont_total" '
      BEGIN {
        if (total <= 0) print 0;
        else print with_because / total;
      }
    ')"
    measured="$ratio"
    reference="$(jq -c '.I3_formula_ratio.reference' "$THRESHOLDS_FILE")"
    score="$(score_ratio "$ratio")"
    detail="Found ${dont_with_because} Dont/Because rules out of ${dont_total} total"
  else
    measured="0"
    reference="$(jq -c '.I3_formula_ratio.reference' "$THRESHOLDS_FILE")"
    score="0"
    detail="Skipped because no entry file exists"
  fi
  emit_result "$project_name" "I3" "$measured" "$reference" "$score" "$detail"

  # I4
  if [ -n "$entry_abs" ]; then
    action_count=0
    identity_count=0
    while IFS= read -r heading || [ -n "$heading" ]; do
      heading_lower="$(lower_text "$heading")"
      case "$heading_lower" in
        *workflow*|*session*|*rules*|*writing*|*debugging*|*how*|*build*|*test*|*deploy*|*setup*|*install*|*config*|*run*|*development*|*contributing*|*commands*|*scripts*|*usage*|*prerequisites*|*getting*started*)
          action_count=$((action_count + 1))
          ;;
      esac
      case "$heading_lower" in
        *personality*|*role*|*capabilities*|*who*|*about*me*|*identity*|*persona*)
          identity_count=$((identity_count + 1))
          ;;
      esac
    done <<EOF
$(grep -E '^##[[:space:]]+' "$entry_abs" 2>/dev/null | sed -E 's/^##[[:space:]]+//')
EOF
    measured="$(jq -cn --argjson action "$action_count" --argjson identity "$identity_count" '{action: $action, identity: $identity}')"
    score="$(awk -v action="$action_count" -v identity="$identity_count" '
      BEGIN {
        total = action + identity;
        if (total <= 0) print 0;
        else print action / total;
      }
    ')"
    detail="Action-oriented headings: ${action_count}; identity headings: ${identity_count}"
  else
    measured='{"action":0,"identity":0}'
    score="0"
    detail="Skipped because no entry file exists"
  fi
  emit_result "$project_name" "I4" "$measured" "null" "$score" "$detail"

  # I5
  if [ -n "$entry_abs" ]; then
    identity_language_count="$(grep -Eio "You are a |You're a |As an AI|As a developer" "$entry_abs" 2>/dev/null | wc -l | tr -d '[:space:]')" || true
    measured="$identity_language_count"
    reference="0"
    if [ "$identity_language_count" -eq 0 ]; then
      score="1"
      detail="No identity language matches found"
    else
      score="0"
      detail="Found ${identity_language_count} identity-language matches"
    fi
  else
    measured="0"
    reference="0"
    score="0"
    detail="Skipped because no entry file exists"
  fi
  emit_result "$project_name" "I5" "$measured" "$reference" "$score" "$detail"

  # I6
  if [ -n "$entry_abs" ]; then
    line_count_value="$(count_lines "$entry_abs")"
    measured="$line_count_value"
    reference="$(jq -c '.I6_length.reference_lines' "$THRESHOLDS_FILE")"
    score="$(score_range "$line_count_value" "$(jq -r '.I6_length.reference_lines[0]' "$THRESHOLDS_FILE")" "$(jq -r '.I6_length.reference_lines[1]' "$THRESHOLDS_FILE")")"
    detail="${entry_rel} has ${line_count_value} lines"
  else
    measured="0"
    reference="$(jq -c '.I6_length.reference_lines' "$THRESHOLDS_FILE")"
    score="0"
    detail="Skipped because no entry file exists"
  fi
  emit_result "$project_name" "I6" "$measured" "$reference" "$score" "$detail"

  # W1
  if [ -n "$entry_abs" ]; then
    commands_json="$(extract_command_matches "$entry_abs")"
    if [ "$commands_json" != "[]" ]; then
      score="1"
      detail="Found build/test commands in ${entry_rel}"
    else
      score="0"
      detail="No build/test commands found in ${entry_rel}"
    fi
    emit_result "$project_name" "W1" "$commands_json" "null" "$score" "$detail"
  else
    emit_result "$project_name" "W1" "[]" "null" "0" "Skipped because no entry file exists"
  fi

  # W2
  workflow_total="$(workflow_count "$project_dir")"
  if [ "$workflow_total" -gt 0 ]; then
    score="1"
    detail="Found ${workflow_total} workflow files"
  else
    score="0"
    detail="No GitHub workflow files found"
  fi
  emit_result "$project_name" "W2" "$workflow_total" "null" "$score" "$detail"

  # W3
  test_total="$(test_file_count "$project_dir")"
  if [ "$test_total" -gt 0 ]; then
    score="1"
    detail="Found ${test_total} test files"
  else
    score="0"
    detail="No test files found"
  fi
  emit_result "$project_name" "W3" "$test_total" "null" "$score" "$detail"

  # W4
  linter_json="$(linter_configs_json "$project_dir")"
  if [ "$linter_json" != "[]" ]; then
    score="1"
    detail="Found linter or formatter configuration"
  else
    score="0"
    detail="No linter or formatter configuration found"
  fi
  emit_result "$project_name" "W4" "$linter_json" "null" "$score" "$detail"

  # C1
  if [ -n "$entry_abs" ]; then
    code_ts="$(git_code_timestamp "$project_dir")" || true
    if [ -z "$code_ts" ]; then
      code_ts="$(filesystem_code_timestamp "$project_dir")" || true
    fi
    entry_ts="$(entry_timestamp "$project_dir" "$entry_rel")"
    if [ -n "$entry_ts" ] && [ -n "$code_ts" ] && [ "$code_ts" -gt 0 ]; then
      freshness_days="$(awk -v code_ts="$code_ts" -v entry_ts="$entry_ts" '
        BEGIN {
          diff = code_ts - entry_ts;
          if (diff < 0) diff = 0;
          print int(diff / 86400);
        }
      ')"
      measured="$freshness_days"
      reference="$(jq -c '.C1_freshness_days.reference' "$THRESHOLDS_FILE")"
      score="$(score_upper_bound "$freshness_days" "$(jq -r '.C1_freshness_days.reference' "$THRESHOLDS_FILE")")"
      detail="Entry file trails latest code change by ${freshness_days} days"
    else
      measured="0"
      reference="$(jq -c '.C1_freshness_days.reference' "$THRESHOLDS_FILE")"
      score="1"
      detail="Could not determine comparable timestamps (skipped)"
    fi
  else
    measured="0"
    reference="$(jq -c '.C1_freshness_days.reference' "$THRESHOLDS_FILE")"
    score="0"
    detail="Skipped because no entry file exists"
  fi
  emit_result "$project_name" "C1" "$measured" "$reference" "$score" "$detail"

  # C2
  handoff_found=false
  if [ -f "${project_dir}/HANDOFF.md" ] || [ -f "${project_dir}/.handoff" ]; then
    handoff_found=true
  fi
  if [ "$handoff_found" = true ]; then
    emit_result "$project_name" "C2" "true" "null" "1" "Found handoff or progress information"
  else
    emit_result "$project_name" "C2" "false" "null" "0" "No handoff or progress information found"
  fi

  # C3
  if [ -f "${project_dir}/CHANGELOG.md" ]; then
    changelog_lines="$(count_lines "${project_dir}/CHANGELOG.md")"
  else
    changelog_lines=0
  fi
  if [ "$changelog_lines" -gt 0 ]; then
    score="1"
    detail="CHANGELOG.md has ${changelog_lines} lines"
  else
    score="0"
    detail="CHANGELOG.md missing or empty"
  fi
  emit_result "$project_name" "C3" "$changelog_lines" "null" "$score" "$detail"

  # C4
  for file in "docs/plans" "docs/exec-plans" ".claude/plans" "plans"; do
    if [ -d "${project_dir}/${file}" ]; then
      plan_dirs[${#plan_dirs[@]}]="$file"
    fi
  done
  if [ "${#plan_dirs[@]}" -eq 0 ]; then
    plans_json='[]'
    score="0"
    detail="No plan directories found"
  else
    plans_json="$(json_array "${plan_dirs[@]}")"
    score="1"
    detail="Found plan directories: $(printf '%s, ' "${plan_dirs[@]}" | sed 's/, $//')"
  fi
  emit_result "$project_name" "C4" "$plans_json" "null" "$score" "$detail"

  # C5 — CLAUDE.local.md not tracked in git (Claude Code only)
  if [ "$platform" = "claude" ]; then
    if [ -f "${project_dir}/CLAUDE.local.md" ]; then
      if git -C "$project_dir" ls-files --error-unmatch "CLAUDE.local.md" >/dev/null 2>&1; then
        emit_result "$project_name" "C5" "true" "null" "0" "CLAUDE.local.md is tracked in git — should be in .gitignore"
      else
        emit_result "$project_name" "C5" "false" "null" "1" "CLAUDE.local.md exists and is not tracked (good)"
      fi
    else
      emit_result "$project_name" "C5" "null" "null" "1" "No CLAUDE.local.md (OK)"
    fi
  else
    emit_result "$project_name" "C5" "null" "null" "1" "Skipped: CLAUDE.local.md is Claude Code specific"
  fi

  # I7 — Entry file size within 40,000 character limit
  if [ -n "$entry_abs" ]; then
    local char_count=0
    char_count="$(wc -c < "$entry_abs" | tr -d '[:space:]')"
    if [ "$char_count" -le 40000 ]; then
      score="1"
      detail="${entry_rel} is ${char_count} characters (limit: 40,000)"
    else
      score="$(awk -v cc="$char_count" 'BEGIN { s = 40000 / cc; if (s < 0) s = 0; if (s > 1) s = 1; print s }')"
      detail="${entry_rel} is ${char_count} characters — exceeds Claude Code 40,000 char limit"
    fi
    emit_result "$project_name" "I7" "$char_count" "40000" "$score" "$detail"
  else
    emit_result "$project_name" "I7" "0" "40000" "0" "Skipped because no entry file exists"
  fi

  # F7 — @include directives resolve (Claude Code / Cursor MDC only)
  if [ "$platform" = "claude" ] || [ "$platform" = "cursor-mdc" ]; then
    if [ -n "$entry_abs" ]; then
      local include_total=0
      local include_broken=0
      local include_target=""
      while IFS= read -r line || [ -n "$line" ]; do
        # Match @./path, @path, @~/path patterns (not inside code blocks)
        # shellcheck disable=SC2016
        if printf '%s\n' "$line" | grep -Eq '^[^`]*@\.?\.?/[^ ]+|^[^`]*@[a-zA-Z][^ ]*\.[a-zA-Z]'; then
          include_target="$(printf '%s\n' "$line" | grep -Eo '@[^ ]+' | head -1 | sed 's/^@//')"
          [ -z "$include_target" ] && continue
          include_total=$((include_total + 1))
          # Resolve relative to project dir
          case "$include_target" in
            ./*|../*)
              [ ! -f "${project_dir}/${include_target}" ] && include_broken=$((include_broken + 1))
              ;;
            ~/*)
              [ ! -f "${HOME}/${include_target#\~/}" ] && include_broken=$((include_broken + 1))
              ;;
            /*)
              [ ! -f "$include_target" ] && include_broken=$((include_broken + 1))
              ;;
            *)
              [ ! -f "${project_dir}/${include_target}" ] && include_broken=$((include_broken + 1))
              ;;
          esac
        fi
      done < "$entry_abs"
      if [ "$include_total" -eq 0 ]; then
        emit_result "$project_name" "F7" "0" "0" "1" "No @include directives found"
      elif [ "$include_broken" -eq 0 ]; then
        emit_result "$project_name" "F7" "0" "0" "1" "All ${include_total} @include directives resolve"
      else
        emit_result "$project_name" "F7" "$include_broken" "0" "0" "${include_broken}/${include_total} @include directives point to missing files"
      fi
    else
      emit_result "$project_name" "F7" "0" "0" "0" "Skipped because no entry file exists"
    fi
  else
    emit_result "$project_name" "F7" "null" "null" "1" "Skipped: @include is Claude Code syntax"
  fi

  # W5 — No oversized source files (> 256 KB)
  local oversized_count=0
  local oversized_examples=""
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    case "$file" in
      *package-lock.json|*yarn.lock|*pnpm-lock.yaml|*bun.lock|*Cargo.lock|*poetry.lock|*uv.lock|*Gemfile.lock|*composer.lock) continue ;;
    esac
    oversized_count=$((oversized_count + 1))
    if [ "$oversized_count" -le 3 ]; then
      local fsize
      fsize="$(wc -c < "$file" 2>/dev/null | tr -d '[:space:]')"
      oversized_examples="${oversized_examples}$(basename "$file")(${fsize}B), "
    fi
  done <<EOF
$(find "$project_dir" -type f -size +262144c \
  -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/__pycache__/*' \
  -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/vendor/*' -not -path '*/.next/*' \
  -not -name 'package-lock.json' -not -name 'yarn.lock' -not -name 'pnpm-lock.yaml' \
  -not -name 'bun.lock' -not -name 'Cargo.lock' -not -name 'poetry.lock' -not -name 'uv.lock' \
  \( -name '*.js' -o -name '*.ts' -o -name '*.py' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.rb' -o -name '*.sql' -o -name '*.json' -o -name '*.yaml' -o -name '*.yml' -o -name '*.md' -o -name '*.sh' -o -name '*.c' -o -name '*.cpp' -o -name '*.h' -o -name '*.cs' -o -name '*.php' -o -name '*.swift' -o -name '*.kt' \) \
  2>/dev/null)
EOF
  if [ "$oversized_count" -eq 0 ]; then
    emit_result "$project_name" "W5" "0" "0" "1" "No source files exceed 256 KB"
  else
    oversized_examples="$(printf '%s' "$oversized_examples" | sed 's/, $//')"
    emit_result "$project_name" "W5" "$oversized_count" "0" "0" "${oversized_count} source files exceed 256 KB (Claude Code cannot read them): ${oversized_examples}"
  fi

  # W6 — Pre-commit hooks are fast
  local hook_file=""
  local hook_time=0
  if [ -f "${project_dir}/.husky/pre-commit" ]; then
    hook_file="${project_dir}/.husky/pre-commit"
  elif [ -f "${project_dir}/.git/hooks/pre-commit" ] && [ -x "${project_dir}/.git/hooks/pre-commit" ]; then
    hook_file="${project_dir}/.git/hooks/pre-commit"
  fi
  if [ -n "$hook_file" ]; then
    # Static analysis — estimate hook speed from known slow commands
    # NEVER execute hook files (RCE risk on untrusted repos)
    local hook_content
    hook_content="$(cat "$hook_file" 2>/dev/null)" || hook_content=""
    if echo "$hook_content" | grep -qE '(tsc|eslint --fix|prettier --write|jest|vitest|mypy|cargo clippy|cargo test|go test|pytest|rspec)'; then
      hook_time="8"
      emit_result "$project_name" "W6" "$hook_time" "10" "0" "Pre-commit hook contains slow commands (estimated ${hook_time}s)"
    else
      hook_time="2"
      emit_result "$project_name" "W6" "$hook_time" "10" "1" "Pre-commit hook looks fast (estimated ${hook_time}s)"
    fi
  else
    emit_result "$project_name" "W6" "0" "10" "1" "No pre-commit hook (OK)"
  fi

  # W7 — Local fast test command documented in entry file
  local has_local_test=false
  if [ -n "$entry_abs" ] && [ -f "$entry_abs" ]; then
    # Look for a code block containing a test command after a "local test" heading
    # Pattern: heading with "test" near a code block that has a test runner command
    local entry_content
    entry_content="$(cat "$entry_abs" 2>/dev/null)" || entry_content=""
    if printf '%s' "$entry_content" | grep -qiE '##[[:space:]]+(local[[:space:]]+test|test[[:space:]]+(command|run)|before[[:space:]]+push)'; then
      # Heading found — check it's followed by a code block with a test command
      if printf '%s' "$entry_content" | grep -qE '(pytest|npm[[:space:]]+test|bun[[:space:]]+test|xcodebuild[[:space:]]+test|cargo[[:space:]]+test|go[[:space:]]+test|jest|vitest|rspec|bash[[:space:]]+tests/)'; then
        has_local_test=true
      fi
    fi
  fi
  if [ "$has_local_test" = true ]; then
    emit_result "$project_name" "W7" "true" "null" "1" "Local fast test command documented in entry file"
  else
    emit_result "$project_name" "W7" "false" "null" "0" "No documented local test command — AI agents don't know what to run before push (add '## Local test' section with executable command)"
  fi

  # W8 — npm test script exists (JS/Node projects)
  local pkg_json="${project_dir}/package.json"
  if [ -f "$pkg_json" ]; then
    local has_test_script=false
    if python3 -c "import json,sys; d=json.load(open('$pkg_json')); sys.exit(0 if d.get('scripts',{}).get('test') else 1)" 2>/dev/null; then
      has_test_script=true
    fi
    if [ "$has_test_script" = true ]; then
      emit_result "$project_name" "W8" "true" "null" "1" "npm test script exists in package.json"
    else
      emit_result "$project_name" "W8" "false" "null" "0" "package.json has no 'scripts.test' — 'npm test' fails with 'missing script' for AI agents"
    fi
  else
    emit_result "$project_name" "W8" "null" "null" "1" "No package.json (not a JS/Node project — skip)"
  fi

  # S1 — .env in .gitignore
  local env_gitignored=false
  local env_tracked=false
  if [ -f "${project_dir}/.gitignore" ] && grep -qE '^\.env' "${project_dir}/.gitignore" 2>/dev/null; then
    env_gitignored=true
  fi
  if git -C "$project_dir" ls-files --error-unmatch ".env" >/dev/null 2>&1; then
    env_tracked=true
  fi
  if [ "$env_tracked" = true ]; then
    emit_result "$project_name" "S1" "true" "null" "0" ".env is tracked in git — secrets may be exposed"
  elif [ "$env_gitignored" = true ]; then
    emit_result "$project_name" "S1" "true" "null" "1" ".env is in .gitignore (good)"
  else
    emit_result "$project_name" "S1" "false" "null" "0" ".env is not in .gitignore — AI tools may expose secrets"
  fi

  # S2 — GitHub Actions SHA pinned
  local wf_dir="${project_dir}/.github/workflows"
  local wf_total=0
  local wf_pinned=0
  if [ -d "$wf_dir" ]; then
    while IFS= read -r wf_file; do
      [ -z "$wf_file" ] && continue
      while IFS= read -r uses_line; do
        [ -z "$uses_line" ] && continue
        wf_total=$((wf_total + 1))
        # SHA pin = 40-char hex after @
        if printf '%s' "$uses_line" | grep -qE '@[0-9a-f]{40}'; then
          wf_pinned=$((wf_pinned + 1))
        fi
      done <<USES
$(grep -E '^\s*(-\s+)?uses:\s' "$wf_file" 2>/dev/null | grep -v '#.*uses:' || true)
USES
    done <<WF
$(find "$wf_dir" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null)
WF
  fi
  if [ "$wf_total" -eq 0 ]; then
    emit_result "$project_name" "S2" "0" "null" "1" "No GitHub Actions (OK)"
  elif [ "$wf_pinned" -eq "$wf_total" ]; then
    emit_result "$project_name" "S2" "$wf_pinned" "$wf_total" "1" "All ${wf_total} action references are SHA-pinned"
  else
    local wf_ratio
    wf_ratio="$(awk -v p="$wf_pinned" -v t="$wf_total" 'BEGIN { print p / t }')"
    emit_result "$project_name" "S2" "$wf_pinned" "$wf_total" "$wf_ratio" "${wf_pinned}/${wf_total} action references are SHA-pinned"
  fi

  # S3 — Secret scanning configured
  local has_secret_scan=false
  if [ -f "${project_dir}/.gitleaks.toml" ]; then
    has_secret_scan=true
  elif [ -f "${project_dir}/.pre-commit-config.yaml" ] && grep -q 'gitleaks' "${project_dir}/.pre-commit-config.yaml" 2>/dev/null; then
    has_secret_scan=true
  elif [ -d "$wf_dir" ] && [ ! -L "$wf_dir" ] && grep -rl 'gitleaks' "$wf_dir" >/dev/null 2>&1; then
    has_secret_scan=true
  fi
  if [ "$has_secret_scan" = true ]; then
    emit_result "$project_name" "S3" "true" "null" "1" "Secret scanning configured"
  else
    emit_result "$project_name" "S3" "false" "null" "0" "No secret scanning (gitleaks or pre-commit) configured"
  fi

  # S4 — SECURITY.md exists
  if [ -f "${project_dir}/SECURITY.md" ] && [ -s "${project_dir}/SECURITY.md" ]; then
    emit_result "$project_name" "S4" "true" "null" "1" "SECURITY.md exists"
  else
    emit_result "$project_name" "S4" "false" "null" "0" "No SECURITY.md — no vulnerability reporting instructions"
  fi

  # S5 — Workflow permissions minimized
  local wf_overpermissioned=0
  if [ -d "$wf_dir" ]; then
    while IFS= read -r wf_file; do
      [ -z "$wf_file" ] && continue
      # Check if contents: write appears at workflow level (before any jobs: key)
      local in_jobs=false
      while IFS= read -r perm_line; do
        case "$perm_line" in
          'jobs:'*) in_jobs=true ;;
        esac
        if [ "$in_jobs" = false ] && printf '%s' "$perm_line" | grep -qE 'contents:\s*write'; then
          wf_overpermissioned=$((wf_overpermissioned + 1))
          break
        fi
      done < "$wf_file"
    done <<WF2
$(find "$wf_dir" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null)
WF2
  fi
  if [ "$wf_overpermissioned" -eq 0 ]; then
    emit_result "$project_name" "S5" "0" "null" "1" "No over-permissioned workflows"
  else
    emit_result "$project_name" "S5" "$wf_overpermissioned" "null" "0" "${wf_overpermissioned} workflow(s) have contents:write at workflow level"
  fi

  # S6 — No hardcoded secrets
  local secret_hits=0
  local secret_examples=""
  if git -C "$project_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    # Note: .env files ARE checked — S6 detects secrets committed in source.
    # S1 separately checks whether .env is gitignored. If .env is tracked AND
    # contains secret patterns, both S1 and S6 should flag it.
    secret_hits="$(git -C "$project_dir" grep -lE \
      'sk-[a-zA-Z0-9]{48,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16}|-----BEGIN.*(PRIVATE|RSA|EC) KEY' \
      -- '*.js' '*.ts' '*.py' '*.rb' '*.go' '*.rs' '*.java' '*.sh' '*.yml' '*.yaml' '*.json' '*.toml' '*.env' '*.env.*' \
      ':!*.lock' \
      2>/dev/null | grep -cEv 'node_modules|\.git/|vendor/|dist/|build/|__pycache__')" || secret_hits=0
    if [ "${secret_hits:-0}" -gt 0 ]; then
      secret_examples="$(git -C "$project_dir" grep -lE \
        'sk-[a-zA-Z0-9]{48,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16}|-----BEGIN.*(PRIVATE|RSA|EC) KEY' \
        -- '*.js' '*.ts' '*.py' '*.rb' '*.go' '*.rs' '*.java' '*.sh' \
        2>/dev/null | grep -v 'node_modules\|\.git\|vendor' | head -3 | tr '\n' ', ' | sed 's/, $//')"
    fi
  fi
  if [ "${secret_hits:-0}" -eq 0 ]; then
    emit_result "$project_name" "S6" "0" "0" "1" "No hardcoded secret patterns found"
  else
    emit_result "$project_name" "S6" "$secret_hits" "0" "0" "${secret_hits} file(s) contain hardcoded secret patterns: ${secret_examples}"
  fi

  # S7 — No personal paths in source
  local path_hits=0
  local path_examples=""
  if git -C "$project_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    # Note: ':!__tests__/*' pathspec triggers "Unimplemented pathspec magic '_'"
    # on git < 2.40 (Debian 12 default). Filter __tests__ via grep instead.
    path_hits="$(git -C "$project_dir" grep -lE '/Users/[a-zA-Z]|/home/[a-z][a-z0-9_-]+/' \
      -- '*.js' '*.ts' '*.py' '*.rb' '*.go' '*.rs' '*.java' '*.sh' '*.yml' '*.yaml' '*.json' '*.toml' \
      ':!.gitleaks.toml' ':!.gitignore' ':!*.example' ':!standards/*' ':!tests/*' ':!test/*' ':!fixtures/*' ':!testdata/*' ':!*.test.*' ':!*.spec.*' ':!*.snap' ':!*.min.js' ':!coverage/*' \
      2>/dev/null | grep -cEv 'node_modules|\.git/|vendor/|dist/|build/|__tests__/')" || path_hits=0
    path_hits="${path_hits:-0}"
    if [ "${path_hits}" -gt 0 ]; then
      path_examples="$(git -C "$project_dir" grep -lE '/Users/[a-zA-Z]|/home/[a-z][a-z0-9_-]+/' \
        -- '*.js' '*.ts' '*.py' '*.rb' '*.go' '*.rs' '*.java' '*.sh' '*.yml' '*.yaml' '*.json' '*.toml' \
        ':!.gitleaks.toml' ':!.gitignore' ':!*.example' ':!standards/*' ':!tests/*' ':!test/*' ':!fixtures/*' ':!testdata/*' ':!*.test.*' ':!*.spec.*' ':!*.snap' ':!*.min.js' ':!coverage/*' \
        2>/dev/null | grep -Ev 'node_modules|\.git/|vendor/|dist/|build/|__tests__/' | head -3 | tr '\n' ', ' | sed 's/, $//')"
    fi
  fi
  if [ "${path_hits:-0}" -eq 0 ]; then
    emit_result "$project_name" "S7" "0" "0" "1" "No personal filesystem paths found in source"
  else
    emit_result "$project_name" "S7" "$path_hits" "0" "0" "${path_hits} file(s) contain personal paths (/Users/ or /home/): ${path_examples}"
  fi

  # S8 — No pull_request_target in workflows
  local prt_count=0
  local prt_files=""
  if [ -d "$wf_dir" ]; then
    while IFS= read -r wf_file; do
      [ -z "$wf_file" ] && continue
      if grep -q 'pull_request_target' "$wf_file" 2>/dev/null; then
        prt_count=$((prt_count + 1))
        prt_files="${prt_files:+${prt_files}, }$(basename "$wf_file")"
      fi
    done <<WF_PRT
$(find "$wf_dir" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null)
WF_PRT
  fi
  if [ "$prt_count" -eq 0 ]; then
    emit_result "$project_name" "S8" "0" "null" "1" "No workflows use pull_request_target"
  else
    emit_result "$project_name" "S8" "$prt_count" "null" "0" "${prt_count} workflow(s) use pull_request_target: ${prt_files}"
  fi

  # S9 — No personal email in git history
  # NEVER execute hook files or user scripts — static analysis only.
  local personal_emails=""
  personal_emails="$(git -C "$project_dir" log --all --format="%ae" 2>/dev/null \
    | grep -vE "(noreply|github-actions|dependabot|action@github\.com|bot@)" \
    | grep "@" | sort -u | head -5 || true)"
  if [ -z "$personal_emails" ]; then
    emit_result "$project_name" "S9" "0" "null" "1" "No personal email addresses found in git history"
  else
    local email_count
    email_count="$(printf '%s\n' "$personal_emails" | wc -l | tr -d '[:space:]')"
    emit_result "$project_name" "S9" "$email_count" "null" "0" "Personal email(s) in git history: ${personal_emails} — PII in public commit history"
  fi

  # ─── Harness dimension (v0.6.0) ───
  local settings_path="${project_dir}/.claude/settings.json"

  # H1 — Hook event names valid
  if [ ! -f "$settings_path" ]; then
    emit_result "$project_name" "H1" '{"total":0,"valid":0,"invalid":[]}' "null" "1" "No settings.json — nothing to validate"
  else
    local valid_events_list
    valid_events_list="$(jq -r '.H1_valid_events[]' "$THRESHOLDS_FILE" 2>/dev/null)"
    local configured_events
    configured_events="$(jq -r '(.hooks // {}) | keys[]?' "$settings_path" 2>/dev/null)" || configured_events=""
    local h1_total=0
    local h1_valid=0
    local h1_invalid=""
    while IFS= read -r evt; do
      [ -z "$evt" ] && continue
      h1_total=$((h1_total + 1))
      if printf '%s\n' "$valid_events_list" | grep -qxF "$evt"; then
        h1_valid=$((h1_valid + 1))
      else
        h1_invalid="${h1_invalid:+$h1_invalid, }$evt"
      fi
    done <<EOF_H1
$configured_events
EOF_H1
    if [ "$h1_total" -eq 0 ]; then
      emit_result "$project_name" "H1" '{"total":0,"valid":0,"invalid":[]}' "null" "1" "No hooks configured"
    else
      local h1_measured
      h1_measured="$(jq -cn --argjson total "$h1_total" --argjson valid "$h1_valid" --arg invalid "$h1_invalid" \
        '{total: $total, valid: $valid, invalid: ($invalid | split(", ") | map(select(length > 0)))}')"
      local h1_score
      h1_score="$(awk -v v="$h1_valid" -v t="$h1_total" 'BEGIN { if (t <= 0) print 1; else print v/t }')"
      local h1_detail="Valid hook events: ${h1_valid}/${h1_total}"
      [ -n "$h1_invalid" ] && h1_detail="${h1_detail}. Invalid: ${h1_invalid}"
      emit_result "$project_name" "H1" "$h1_measured" "null" "$h1_score" "$h1_detail"
    fi
  fi

  # H2 — PreToolUse hooks have matcher
  if [ ! -f "$settings_path" ]; then
    emit_result "$project_name" "H2" '{"total":0,"with_matcher":0}' "null" "1" "No settings.json"
  else
    local h2_total
    h2_total="$(jq '[.hooks.PreToolUse[]?] | length' "$settings_path" 2>/dev/null)" || h2_total=0
    local h2_no_matcher
    h2_no_matcher="$(jq '[.hooks.PreToolUse[]? | select((.matcher // "") == "")] | length' "$settings_path" 2>/dev/null)" || h2_no_matcher=0
    if [ "${h2_total:-0}" -eq 0 ]; then
      emit_result "$project_name" "H2" '{"total":0,"with_matcher":0}' "null" "1" "No PreToolUse hooks"
    else
      local h2_with_matcher=$((h2_total - h2_no_matcher))
      local h2_score
      h2_score="$(awk -v w="$h2_with_matcher" -v t="$h2_total" 'BEGIN { print w/t }')"
      local h2_measured
      h2_measured="$(jq -cn --argjson total "$h2_total" --argjson with_matcher "$h2_with_matcher" '{total: $total, with_matcher: $with_matcher}')"
      emit_result "$project_name" "H2" "$h2_measured" "null" "$h2_score" "PreToolUse hooks with matcher: ${h2_with_matcher}/${h2_total}"
    fi
  fi

  # H4 — No dangerous auto-approve
  if [ ! -f "$settings_path" ]; then
    emit_result "$project_name" "H4" '{"dangerous_rules":[],"total_allow":0}' "null" "1" "No settings.json"
  else
    local h4_patterns
    h4_patterns="$(jq -r '.H4_dangerous_patterns[]' "$THRESHOLDS_FILE" 2>/dev/null)"
    local h4_rules
    h4_rules="$(jq -r '.permissions.allow[]?' "$settings_path" 2>/dev/null)" || h4_rules=""
    local h4_total_allow=0
    local h4_dangerous=""
    while IFS= read -r rule; do
      [ -z "$rule" ] && continue
      h4_total_allow=$((h4_total_allow + 1))
      while IFS= read -r pat; do
        [ -z "$pat" ] && continue
        if printf '%s\n' "$rule" | grep -Eq "$pat"; then
          h4_dangerous="${h4_dangerous:+$h4_dangerous, }$rule"
          break
        fi
      done <<EOF_H4P
$h4_patterns
EOF_H4P
    done <<EOF_H4R
$h4_rules
EOF_H4R
    if [ -z "$h4_dangerous" ]; then
      local h4_measured
      h4_measured="$(jq -cn --argjson total "$h4_total_allow" '{dangerous_rules: [], total_allow: $total}')"
      emit_result "$project_name" "H4" "$h4_measured" "null" "1" "No dangerous auto-approve rules (checked ${h4_total_allow})"
    else
      local h4_measured
      h4_measured="$(jq -cn --argjson total "$h4_total_allow" --arg d "$h4_dangerous" \
        '{dangerous_rules: ($d | split(", ") | map(select(length > 0))), total_allow: $total}')"
      emit_result "$project_name" "H4" "$h4_measured" "null" "0" "Dangerous auto-approve rule(s) found: ${h4_dangerous}"
    fi
  fi

  # H3 — Stop hook has circuit breaker (static analysis, never executes scripts)
  if [ ! -f "$settings_path" ]; then
    emit_result "$project_name" "H3" '{"stop_hooks":0,"guarded":0}' "null" "1" "No settings.json"
  else
    local stop_total
    stop_total="$(jq '[.hooks.Stop[]?.hooks[]?.command // empty] | length' "$settings_path" 2>/dev/null)" || stop_total=0
    if [ "${stop_total:-0}" -eq 0 ]; then
      emit_result "$project_name" "H3" '{"stop_hooks":0,"guarded":0}' "null" "1" "No Stop hooks configured"
    else
      local stop_commands
      stop_commands="$(jq -r '.hooks.Stop[]?.hooks[]?.command // empty' "$settings_path" 2>/dev/null)" || stop_commands=""
      local h3_guarded=0
      local h3_unresolvable=0
      while IFS= read -r cmd; do
        [ -z "$cmd" ] && continue
        local script_path
        script_path="$(extract_script_path "$cmd" "$project_dir")"
        if [ "$script_path" = "INLINE" ]; then
          # Check inline command text itself for guard
          if printf '%s\n' "$cmd" | grep -Eq 'stop_hook_active|STOP_HOOK_ACTIVE|CLAUDE_STOP_HOOK|STOP_HOOK_GUARD|exit 0.*#.*loop|anti.?loop'; then
            h3_guarded=$((h3_guarded + 1))
          fi
        elif [ -z "$script_path" ] || [ ! -f "$script_path" ]; then
          h3_unresolvable=$((h3_unresolvable + 1))
        else
          if grep -Eq 'stop_hook_active|STOP_HOOK_ACTIVE|CLAUDE_STOP_HOOK|STOP_HOOK_GUARD|exit 0.*#.*loop|anti.?loop' "$script_path" 2>/dev/null; then
            h3_guarded=$((h3_guarded + 1))
          fi
        fi
      done <<EOF_H3
$stop_commands
EOF_H3
      local h3_measured
      h3_measured="$(jq -cn --argjson total "$stop_total" --argjson guarded "$h3_guarded" --argjson unres "$h3_unresolvable" \
        '{stop_hooks: $total, guarded: $guarded, unresolvable: $unres}')"
      if [ "$h3_guarded" -eq "$stop_total" ]; then
        emit_result "$project_name" "H3" "$h3_measured" "null" "1" "All ${stop_total} Stop hook(s) have loop protection"
      elif [ "$h3_unresolvable" -gt 0 ] && [ "$((h3_guarded + h3_unresolvable))" -eq "$stop_total" ]; then
        # Some unresolvable; give partial credit
        emit_result "$project_name" "H3" "$h3_measured" "null" "0.5" "${h3_guarded}/${stop_total} guarded, ${h3_unresolvable} unresolvable script path(s)"
      else
        emit_result "$project_name" "H3" "$h3_measured" "null" "0" "${h3_guarded}/${stop_total} Stop hook(s) have circuit breaker — risk of infinite loop"
      fi
    fi
  fi

  # H5 — Env deny coverage complete
  if [ ! -f "$settings_path" ]; then
    emit_result "$project_name" "H5" "null" "null" "1" "No settings.json"
  else
    local deny_has_env=false
    local deny_has_variant=false
    local deny_rules
    deny_rules="$(jq -r '.permissions.deny[]?' "$settings_path" 2>/dev/null)" || deny_rules=""
    while IFS= read -r rule; do
      [ -z "$rule" ] && continue
      # Matches Read(./.env), Read(.env), Read(.env.local), Read(./.env.*), etc
      case "$rule" in
        *".env."*|*".env*"*) deny_has_variant=true; deny_has_env=true ;;
        *".env"*) deny_has_env=true ;;
      esac
    done <<EOF_H5
$deny_rules
EOF_H5
    if [ "$deny_has_env" = false ]; then
      emit_result "$project_name" "H5" '{"deny_env":false,"deny_variants":false}' "null" "1" "No .env deny rules (N/A)"
    elif [ "$deny_has_variant" = true ]; then
      emit_result "$project_name" "H5" '{"deny_env":true,"deny_variants":true}' "null" "1" ".env + variants covered"
    else
      emit_result "$project_name" "H5" '{"deny_env":true,"deny_variants":false}' "null" "0.5" ".env denied but .env.* variants (e.g. .env.local, .env.production) are not"
    fi
  fi

  # H6 — Hook scripts network access (static analysis, never executes scripts)
  if [ ! -f "$settings_path" ]; then
    emit_result "$project_name" "H6" '{"hooks_with_network":0}' "null" "1" "No settings.json"
  else
    local all_hook_commands
    all_hook_commands="$(jq -r '.hooks // {} | to_entries[]? | .value[]? | .hooks[]? | .command // empty' "$settings_path" 2>/dev/null)" || all_hook_commands=""
    local h6_network_count=0
    local h6_total=0
    while IFS= read -r cmd; do
      [ -z "$cmd" ] && continue
      h6_total=$((h6_total + 1))
      local script_path
      script_path="$(extract_script_path "$cmd" "$project_dir")"
      if [ "$script_path" = "INLINE" ]; then
        if printf '%s\n' "$cmd" | grep -Eq 'curl |wget |urllib\.request|requests\.(post|get|put)|fetch\(|axios\.|http\.request|https?://hooks\.|webhook'; then
          h6_network_count=$((h6_network_count + 1))
        fi
      elif [ -n "$script_path" ] && [ -f "$script_path" ]; then
        if grep -Eq 'curl |wget |urllib\.request|requests\.(post|get|put)|fetch\(|axios\.|http\.request|https?://hooks\.|webhook' "$script_path" 2>/dev/null; then
          h6_network_count=$((h6_network_count + 1))
        fi
      fi
    done <<EOF_H6
$all_hook_commands
EOF_H6
    if [ "$h6_total" -eq 0 ]; then
      emit_result "$project_name" "H6" '{"hooks_with_network":0,"total_hooks":0}' "null" "1" "No hooks configured"
    elif [ "$h6_network_count" -eq 0 ]; then
      local h6_measured
      h6_measured="$(jq -cn --argjson total "$h6_total" '{hooks_with_network: 0, total_hooks: $total}')"
      emit_result "$project_name" "H6" "$h6_measured" "null" "1" "No hook scripts detected making network calls"
    else
      local h6_measured
      h6_measured="$(jq -cn --argjson count "$h6_network_count" --argjson total "$h6_total" '{hooks_with_network: $count, total_hooks: $total}')"
      emit_result "$project_name" "H6" "$h6_measured" "null" "0" "${h6_network_count}/${h6_total} hook script(s) make external network calls — review for legitimacy"
    fi
  fi

  # H7 — Gate workflows are blocking (not warn-only)
  local h7_warn_only=0
  local h7_gate_total=0
  if [ -d "$wf_dir" ]; then
    while IFS= read -r wf_file; do
      [ -z "$wf_file" ] && continue
      local wf_name
      wf_name="$(basename "$wf_file" .yml)"
      # Only check workflows that look like gates
      if printf '%s' "$wf_name" | grep -qiE '(required|gate|test-required|size|check)'; then
        h7_gate_total=$((h7_gate_total + 1))
        local wf_content
        wf_content="$(cat "$wf_file" 2>/dev/null)" || wf_content=""
        # Check if any failure path has exit 1 (blocking)
        if ! printf '%s' "$wf_content" | grep -qE 'exit[[:space:]]+1'; then
          h7_warn_only=$((h7_warn_only + 1))
        fi
      fi
    done <<H7WF
$(find "$wf_dir" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null)
H7WF
  fi
  if [ "$h7_gate_total" -eq 0 ]; then
    emit_result "$project_name" "H7" "0" "null" "1" "No gate workflows found (OK)"
  elif [ "$h7_warn_only" -eq 0 ]; then
    emit_result "$project_name" "H7" "$h7_gate_total" "null" "1" "All ${h7_gate_total} gate workflow(s) are blocking (exit 1 on failure)"
  else
    emit_result "$project_name" "H7" "$h7_warn_only" "null" "0" "${h7_warn_only}/${h7_gate_total} gate workflow(s) are warn-only (always exit 0) — they never block merge"
  fi

  # F8 — Rule file frontmatter uses globs not paths
  local rules_dir="${project_dir}/.claude/rules"
  if [ ! -d "$rules_dir" ] || [ -L "$rules_dir" ]; then
    emit_result "$project_name" "F8" '{"total_scoped":0}' "null" "1" "No .claude/rules directory"
  else
    local f8_total_scoped=0
    local f8_uses_globs=0
    while IFS= read -r rule_file; do
      [ -z "$rule_file" ] && continue
      # Skip symlinks and non-regular files
      is_regular_file "$rule_file" || continue
      # Parse YAML frontmatter (between first two --- markers)
      local in_fm=false
      local has_scope=false
      local has_globs=false
      while IFS= read -r line || [ -n "$line" ]; do
        if [ "$line" = "---" ]; then
          if [ "$in_fm" = true ]; then
            break
          fi
          in_fm=true
          continue
        fi
        [ "$in_fm" = true ] || continue
        case "$line" in
          paths:*) has_scope=true ;;
          globs:*) has_scope=true; has_globs=true ;;
        esac
      done < "$rule_file"
      if [ "$has_scope" = true ]; then
        f8_total_scoped=$((f8_total_scoped + 1))
        [ "$has_globs" = true ] && f8_uses_globs=$((f8_uses_globs + 1))
      fi
    done <<EOF_F8
$(find "$rules_dir" -maxdepth 1 -name '*.md' 2>/dev/null)
EOF_F8
    if [ "$f8_total_scoped" -eq 0 ]; then
      emit_result "$project_name" "F8" '{"total_scoped":0,"uses_globs":0}' "null" "1" "No scoped rule files"
    else
      local f8_score
      f8_score="$(awk -v g="$f8_uses_globs" -v t="$f8_total_scoped" 'BEGIN { print g/t }')"
      local f8_measured
      f8_measured="$(jq -cn --argjson t "$f8_total_scoped" --argjson g "$f8_uses_globs" '{total_scoped: $t, uses_globs: $g}')"
      emit_result "$project_name" "F8" "$f8_measured" "null" "$f8_score" "Rule files using globs: ${f8_uses_globs}/${f8_total_scoped}"
    fi
  fi

  # F9 — No unfilled template placeholders (uses grep -E only for macOS compat, no -P)
  if [ -n "$entry_abs" ]; then
    local f9_hits=0
    # Pattern 1: [your X], [project X], [框架 X] — bracketed placeholders
    local f9_bracket_all
    f9_bracket_all="$(grep -Eic '\[(你的|your |project |框架|版本|app |name)[^]]*\]' "$entry_abs" 2>/dev/null)" || f9_bracket_all=0
    local f9_bracket_links
    f9_bracket_links="$(grep -Eic '\[(你的|your |project |框架|版本|app |name)[^]]*\]\(' "$entry_abs" 2>/dev/null)" || f9_bracket_links=0
    f9_hits=$((f9_hits + f9_bracket_all - f9_bracket_links))
    # Pattern 2: <your X>, <project X>, etc
    local f9_angle
    f9_angle="$(grep -Eic '<(your|project|app|framework)[^>]*>' "$entry_abs" 2>/dev/null)" || f9_angle=0
    f9_hits=$((f9_hits + f9_angle))
    # Pattern 3: TODO:/FIXME:/XXX:/Not configured
    local f9_marker
    f9_marker="$(grep -Eic '^[[:space:]]*(Not configured|TODO:|FIXME:|XXX:)' "$entry_abs" 2>/dev/null)" || f9_marker=0
    f9_hits=$((f9_hits + f9_marker))
    if [ "$f9_hits" -le 0 ]; then
      emit_result "$project_name" "F9" "0" "0" "1" "No template placeholders found"
    else
      emit_result "$project_name" "F9" "$f9_hits" "0" "0" "Found ${f9_hits} unfilled template placeholder(s)"
    fi
  else
    emit_result "$project_name" "F9" "null" "null" "0" "Skipped because no entry file exists"
  fi

  # I8 — Total injected content within budget
  local total_injected=0
  if [ -n "$entry_abs" ]; then
    local entry_lines
    entry_lines="$(grep -cv '^[[:space:]]*$' "$entry_abs" 2>/dev/null)" || entry_lines=0
    total_injected=$((total_injected + entry_lines))
  fi
  # Also include AGENTS.md if different from entry file
  if [ -f "${project_dir}/AGENTS.md" ] && [ "$entry_rel" != "AGENTS.md" ]; then
    local agents_lines
    agents_lines="$(grep -cv '^[[:space:]]*$' "${project_dir}/AGENTS.md" 2>/dev/null)" || agents_lines=0
    total_injected=$((total_injected + agents_lines))
  fi
  # Include .claude/rules/*.md
  if [ -d "${project_dir}/.claude/rules" ]; then
    while IFS= read -r rf; do
      [ -z "$rf" ] && continue
      local rf_lines
      rf_lines="$(grep -cv '^[[:space:]]*$' "$rf" 2>/dev/null)" || rf_lines=0
      total_injected=$((total_injected + rf_lines))
    done <<EOF_I8
$(find "${project_dir}/.claude/rules" -maxdepth 1 -name '*.md' 2>/dev/null)
EOF_I8
  fi
  local i8_low i8_high
  i8_low="$(jq -r '.I8_total_lines.reference_lines[0]' "$THRESHOLDS_FILE" 2>/dev/null)"
  i8_high="$(jq -r '.I8_total_lines.reference_lines[1]' "$THRESHOLDS_FILE" 2>/dev/null)"
  local i8_score
  i8_score="$(score_range "$total_injected" "$i8_low" "$i8_high")"
  emit_result "$project_name" "I8" "$total_injected" "[${i8_low},${i8_high}]" "$i8_score" "Total injected content: ${total_injected} non-empty lines (reference: ${i8_low}-${i8_high})"
}

discover_projects() {
  local projects_root="$1"

  [ -d "$projects_root" ] || return 0

  if [ -d "${projects_root}/.git" ] || [ -f "${projects_root}/.git" ]; then
    printf '%s\n' "$projects_root"
  fi

  find "$projects_root" -mindepth 1 -maxdepth 4 -type d -name '.git' 2>/dev/null | while IFS= read -r gitdir; do
    printf '%s\n' "$(dirname "$gitdir")"
  done | sort -u
}

main() {
  local project_dir=""
  local projects_root="${PROJECTS_ROOT:-${HOME}/Projects}"
  local -a projects=()
  local arg=""

  require_command jq

  [ -f "$EVIDENCE_FILE" ] || {
    printf '%s\n' "Missing required file: $EVIDENCE_FILE" >&2
    exit 1
  }
  [ -f "$THRESHOLDS_FILE" ] || {
    printf '%s\n' "Missing required file: $THRESHOLDS_FILE" >&2
    exit 1
  }

  while [ "$#" -gt 0 ]; do
    arg="$1"
    case "$arg" in
      --project-dir)
        shift
        [ "$#" -gt 0 ] || {
          printf '%s\n' "--project-dir requires a path" >&2
          exit 1
        }
        project_dir="$1"
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        printf '%s\n' "Unknown argument: $arg" >&2
        usage
        exit 1
        ;;
    esac
    shift
  done

  if [ -n "$project_dir" ]; then
    if [ ! -d "$project_dir" ]; then
      printf '%s\n' "Project directory not found: $project_dir" >&2
      exit 1
    fi
    scan_project "$(CDPATH='' cd -- "$project_dir" && pwd)"
    exit 0
  fi

  while IFS= read -r arg; do
    [ -z "$arg" ] && continue
    projects[${#projects[@]}]="$arg"
  done <<EOF
$(discover_projects "$projects_root")
EOF

  for project_dir in "${projects[@]}"; do
    scan_project "$project_dir"
  done
}

main "$@"
