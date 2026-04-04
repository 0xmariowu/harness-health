#!/usr/bin/env bash

set -u

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

entry_file_rel() {
  local project_dir="$1"
  if [ -f "${project_dir}/CLAUDE.md" ]; then
    printf '%s\n' "CLAUDE.md"
  elif [ -f "${project_dir}/AGENTS.md" ]; then
    printf '%s\n' "AGENTS.md"
  elif [ -f "${project_dir}/.cursorrules" ]; then
    printf '%s\n' ".cursorrules"
  else
    printf '\n'
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
      candidate="$(normalize_reference "${BASH_REMATCH[1]}")"
      if looks_like_reference "$candidate"; then
        printf '%s\n' "$candidate"
      fi
      rest="${rest#*"${BASH_REMATCH[0]}"}"
    done
  done < "$entry_file" | sort -u
}

resolve_reference_exists() {
  local project_dir="$1"
  local ref="$2"

  if [ -z "$ref" ]; then
    return 1
  elif [ -e "$ref" ]; then
    return 0
  elif [ -e "${project_dir}/${ref#./}" ]; then
    return 0
  fi

  # For bare filenames (no /), search subdirectories by name
  if [[ "$ref" != */* ]] && [[ "$ref" == *.* ]]; then
    if find "$project_dir" -maxdepth 4 -name "$ref" -print -quit 2>/dev/null | grep -q .; then
      return 0
    fi
  fi

  # For relative paths with /, try matching the last component
  if [[ "$ref" == */* ]] && [[ "$ref" != /* ]]; then
    local basename="${ref##*/}"
    if [ -n "$basename" ] && [[ "$basename" == *.* ]]; then
      if find "$project_dir" -maxdepth 4 -name "$basename" -print -quit 2>/dev/null | grep -q .; then
        return 0
      fi
    fi
    # Also try the last directory component as a directory name
    local dirname="${ref%%/*}"
    if find "$project_dir" -maxdepth 3 -type d -name "$dirname" -print -quit 2>/dev/null | grep -q .; then
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
  find "$project_dir" -type f 2>/dev/null | while IFS= read -r file; do
    case "$file" in
      */.git/*|*/node_modules/*|*/__pycache__/*|*/dist/*|*/build/*|*/vendor/*) continue ;;
    esac

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

  while IFS= read -r file; do
    case "$file" in
      */.git/*|*/node_modules/*|*/__pycache__/*|*/dist/*|*/build/*|*/vendor/*|*/docs/*|*/standards/*) continue ;;
    esac
    case "$file" in
      *.sh|*.bash|*.zsh|*.js|*.jsx|*.ts|*.tsx|*.py|*.rb|*.go|*.rs|*.java|*.kt|*.swift|*.c|*.cc|*.cpp|*.h|*.hpp|*.cs|*.php|*.m|*.mm|*.scala|*.sql)
        ts="$(portable_stat_mtime "$file")"
        if [ -n "$ts" ] && [ "$ts" -gt "$newest" ]; then
          newest="$ts"
        fi
        ;;
    esac
  done <<EOF
$(find "$project_dir" -type f 2>/dev/null)
EOF

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

  dimension="$(jq -r --arg id "$check_id" '.checks[$id].dimension' "$EVIDENCE_FILE")"
  check_name="$(jq -r --arg id "$check_id" '.checks[$id].name' "$EVIDENCE_FILE")"

  jq -cn \
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
    }'
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

  # F1
  if [ -n "$entry_rel" ]; then
    emit_result "$project_name" "F1" "true" "null" "1" "Entry file found: ${entry_rel}"
  else
    emit_result "$project_name" "F1" "false" "null" "0" "No CLAUDE.md, AGENTS.md, or .cursorrules found"
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
    count_important="$(tr -cs '[:alpha:]' '\n' < "$entry_abs" | grep -cx 'IMPORTANT')"
    count_never="$(tr -cs '[:alpha:]' '\n' < "$entry_abs" | grep -cx 'NEVER')"
    count_must="$(tr -cs '[:alpha:]' '\n' < "$entry_abs" | grep -cx 'MUST')"
    count_critical="$(tr -cs '[:alpha:]' '\n' < "$entry_abs" | grep -cx 'CRITICAL')"
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
      if printf '%s\n' "${lines[$i]}" | grep -Eq "^[[:space:]]*-[[:space:]]+Don't"; then
        dont_total=$((dont_total + 1))
        for ((j = i + 1; j <= i + 3 && j < ${#lines[@]}; j++)); do
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
        *workflow*|*session*|*rules*|*writing*|*debugging*|*how*)
          action_count=$((action_count + 1))
          ;;
      esac
      case "$heading_lower" in
        *personality*|*role*|*capabilities*|*who*)
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
    identity_language_count="$(grep -Eio "You are a |You're a |As an AI|As a developer" "$entry_abs" 2>/dev/null | wc -l | tr -d '[:space:]')"
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
    code_ts="$(git_code_timestamp "$project_dir")"
    if [ -z "$code_ts" ]; then
      code_ts="$(filesystem_code_timestamp "$project_dir")"
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
  elif [ -n "$entry_abs" ] && grep -Eiq 'handoff|progress|status' "$entry_abs" 2>/dev/null; then
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

  # C5 — CLAUDE.local.md not tracked in git
  if [ -f "${project_dir}/CLAUDE.local.md" ]; then
    if git -C "$project_dir" ls-files --error-unmatch "CLAUDE.local.md" >/dev/null 2>&1; then
      emit_result "$project_name" "C5" "true" "null" "0" "CLAUDE.local.md is tracked in git — should be in .gitignore"
    else
      emit_result "$project_name" "C5" "false" "null" "1" "CLAUDE.local.md exists and is not tracked (good)"
    fi
  else
    emit_result "$project_name" "C5" "null" "null" "1" "No CLAUDE.local.md (OK)"
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

  # F7 — @include directives resolve
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

  # W5 — No oversized source files (> 256 KB)
  local oversized_count=0
  local oversized_examples=""
  while IFS= read -r file; do
    case "$file" in
      */.git/*|*/node_modules/*|*/__pycache__/*|*/dist/*|*/build/*|*/vendor/*|*/.next/*) continue ;;
      *package-lock.json|*yarn.lock|*pnpm-lock.yaml|*bun.lock|*Cargo.lock|*poetry.lock|*uv.lock|*Gemfile.lock|*composer.lock) continue ;;
    esac
    local fsize=0
    fsize="$(wc -c < "$file" 2>/dev/null | tr -d '[:space:]')"
    if [ "${fsize:-0}" -gt 262144 ]; then
      oversized_count=$((oversized_count + 1))
      if [ "$oversized_count" -le 3 ]; then
        oversized_examples="${oversized_examples}$(basename "$file")(${fsize}B), "
      fi
    fi
  done <<EOF
$(find "$project_dir" -type f \( -name '*.js' -o -name '*.ts' -o -name '*.py' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.rb' -o -name '*.sql' -o -name '*.json' -o -name '*.yaml' -o -name '*.yml' -o -name '*.md' -o -name '*.sh' -o -name '*.c' -o -name '*.cpp' -o -name '*.h' -o -name '*.cs' -o -name '*.php' -o -name '*.swift' -o -name '*.kt' \) 2>/dev/null)
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
    # Measure hook execution time (timeout at 15s)
    hook_time="$(cd "$project_dir" && { time timeout 15 bash "$hook_file" >/dev/null 2>&1; } 2>&1 | grep real | awk '{print $2}' | sed 's/[ms]/ /g' | awk '{if (NF==2) print $1*60+$2; else print $1}' 2>/dev/null)" || hook_time="15"
    hook_time="${hook_time:-0}"
    if awk -v t="$hook_time" 'BEGIN { exit (t <= 10) ? 0 : 1 }'; then
      emit_result "$project_name" "W6" "$hook_time" "10" "1" "Pre-commit hook runs in ${hook_time}s (limit: 10s)"
    else
      emit_result "$project_name" "W6" "$hook_time" "10" "0" "Pre-commit hook takes ${hook_time}s — will stall Claude Code commits"
    fi
  else
    emit_result "$project_name" "W6" "0" "10" "1" "No pre-commit hook (OK)"
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
$(grep -E '^\s*uses:\s' "$wf_file" 2>/dev/null | grep -v '#.*uses:')
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
  elif [ -d "$wf_dir" ] && grep -rl 'gitleaks' "$wf_dir" >/dev/null 2>&1; then
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
    secret_hits="$(git -C "$project_dir" grep -lE \
      'sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16}|-----BEGIN.*(PRIVATE|RSA|EC) KEY' \
      -- '*.js' '*.ts' '*.py' '*.rb' '*.go' '*.rs' '*.java' '*.sh' '*.env' '*.yml' '*.yaml' '*.json' '*.toml' \
      2>/dev/null | grep -cv 'node_modules\|\.git\|vendor\|dist\|build\|__pycache__\|\.lock')" || secret_hits=0
    if [ "${secret_hits:-0}" -gt 0 ]; then
      secret_examples="$(git -C "$project_dir" grep -lE \
        'sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16}|-----BEGIN.*(PRIVATE|RSA|EC) KEY' \
        -- '*.js' '*.ts' '*.py' '*.rb' '*.go' '*.rs' '*.java' '*.sh' \
        2>/dev/null | grep -v 'node_modules\|\.git\|vendor' | head -3 | tr '\n' ', ' | sed 's/, $//')"
    fi
  fi
  if [ "${secret_hits:-0}" -eq 0 ]; then
    emit_result "$project_name" "S6" "0" "0" "1" "No hardcoded secret patterns found"
  else
    emit_result "$project_name" "S6" "$secret_hits" "0" "0" "${secret_hits} file(s) contain hardcoded secret patterns: ${secret_examples}"
  fi
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
