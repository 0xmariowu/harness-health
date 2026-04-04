#!/usr/bin/env bash
# Auto-labels 20 repos based on check-spec.md rules.
# Output: tests/accuracy/labels.json
# These labels are the GROUND TRUTH — independent of scanner output.

set -u

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CORPUS_DIR="${AL_CORPUS_DIR:-${HOME}/corpus/sources}"
REPOS_JSON="${ROOT_DIR}/tests/accuracy/repos.json"
OUTPUT="${ROOT_DIR}/tests/accuracy/labels.json"

if [ ! -f "$REPOS_JSON" ]; then
  echo "repos.json not found" >&2
  exit 1
fi

repo_count="$(jq '.repos | length' "$REPOS_JSON")"
echo "Labeling ${repo_count} repos..."
echo "[" > "$OUTPUT"
first=true

for i in $(seq 0 $((repo_count - 1))); do
  repo_path_rel="$(jq -r ".repos[$i].path" "$REPOS_JSON")"
  repo_name="$(jq -r ".repos[$i].name" "$REPOS_JSON")"
  repo_dir="${CORPUS_DIR}/${repo_path_rel}"

  if [ ! -d "$repo_dir" ]; then
    echo "SKIP: ${repo_name} — directory not found" >&2
    continue
  fi

  echo "--- ${repo_name} ---"

  # Initialize all labels
  declare -A labels

  # Find entry file
  entry=""
  for candidate in CLAUDE.md AGENTS.md .cursorrules; do
    if [ -f "${repo_dir}/${candidate}" ]; then
      entry="${candidate}"
      break
    fi
  done

  # F1: Entry file exists
  if [ -n "$entry" ]; then labels[F1]="pass"; else labels[F1]="fail"; fi

  # F2: Project description in first 10 lines
  if [ -n "$entry" ]; then
    desc_found="$(head -10 "${repo_dir}/${entry}" | grep -cE '^#|.{20,}' 2>/dev/null || echo 0)"
    if [ "$desc_found" -gt 0 ]; then labels[F2]="pass"; else labels[F2]="fail"; fi
  else
    labels[F2]="na"
  fi

  # F3: Conditional loading guidance
  if [ -n "$entry" ]; then
    cond_found="$(grep -cEi 'if.*read|Session Checklist|checklist' "${repo_dir}/${entry}" 2>/dev/null || echo 0)"
    if [ "$cond_found" -gt 0 ]; then labels[F3]="pass"; else labels[F3]="fail"; fi
  else
    labels[F3]="na"
  fi

  # F4: Large directories have index
  content_count="$(find "${repo_dir}" -maxdepth 1 -type f ! -name '.*' 2>/dev/null | wc -l | tr -d '[:space:]')"
  has_index="$(find "${repo_dir}" -maxdepth 1 -type f \( -iname 'INDEX' -o -iname 'INDEX.*' \) 2>/dev/null | wc -l | tr -d '[:space:]')"
  if [ "${content_count:-0}" -le 10 ] || [ "${has_index:-0}" -gt 0 ]; then
    labels[F4]="pass"
  else
    labels[F4]="fail"
  fi

  # F5: All references resolve
  if [ -n "$entry" ]; then
    # Extract markdown links [text](path) — same regex as scanner
    broken=0
    total_refs=0
    while IFS= read -r ref; do
      [ -z "$ref" ] && continue
      # Skip URLs
      case "$ref" in http://*|https://*|mailto:*) continue ;; esac
      # Skip anchors
      case "$ref" in \#*) continue ;; esac
      total_refs=$((total_refs + 1))
      # Strip fragment
      ref_path="${ref%%#*}"
      if [ ! -e "${repo_dir}/${ref_path}" ]; then
        broken=$((broken + 1))
      fi
    done <<EOF
$(grep -oE '\[[^]]*\]\(([^)]+)\)' "${repo_dir}/${entry}" 2>/dev/null | sed 's/.*](//' | sed 's/)$//')
EOF
    if [ "$broken" -eq 0 ]; then labels[F5]="pass"; else labels[F5]="fail"; fi
  else
    labels[F5]="na"
  fi

  # F6: Predictable file naming
  has_readme="$([ -f "${repo_dir}/README.md" ] && echo 1 || echo 0)"
  has_entry="$([ -n "$entry" ] && echo 1 || echo 0)"
  has_changelog="$([ -f "${repo_dir}/CHANGELOG.md" ] && echo 1 || echo 0)"
  if [ "$has_readme" -eq 1 ] && [ "$has_entry" -eq 1 ] && [ "$has_changelog" -eq 1 ]; then
    labels[F6]="pass"
  else
    labels[F6]="fail"
  fi

  # F7: @include directives resolve
  if [ -n "$entry" ]; then
    include_count="$(grep -cE '^@[.~/]' "${repo_dir}/${entry}" 2>/dev/null || echo 0)"
    if [ "$include_count" -eq 0 ]; then
      labels[F7]="pass"
    else
      include_broken=0
      while IFS= read -r inc; do
        inc_path="$(echo "$inc" | sed 's/^@//')"
        [ ! -e "${repo_dir}/${inc_path}" ] && include_broken=$((include_broken + 1))
      done <<EOF
$(grep -E '^@[.~/]' "${repo_dir}/${entry}" 2>/dev/null)
EOF
      if [ "$include_broken" -eq 0 ]; then labels[F7]="pass"; else labels[F7]="fail"; fi
    fi
  else
    labels[F7]="na"
  fi

  # I1: Emphasis keyword count (pass if not extreme)
  if [ -n "$entry" ]; then
    kw_total="$(grep -coE 'IMPORTANT|NEVER|MUST|CRITICAL' "${repo_dir}/${entry}" 2>/dev/null || echo 0)"
    # Pass if any reasonable count — exact scoring is complex, label "uncertain" if borderline
    if [ "$kw_total" -le 20 ]; then labels[I1]="pass"; else labels[I1]="uncertain"; fi
  else
    labels[I1]="na"
  fi

  # I2: Keyword density (similar — label uncertain for borderline)
  if [ -n "$entry" ]; then
    labels[I2]="uncertain"  # Density requires exact calculation, mark for manual review
  else
    labels[I2]="na"
  fi

  # I3: Rule specificity
  if [ -n "$entry" ]; then
    dont_count="$(grep -ciE "^-.*Don't|^-.*Do not" "${repo_dir}/${entry}" 2>/dev/null || echo 0)"
    because_count="$(grep -ci "Because:" "${repo_dir}/${entry}" 2>/dev/null || echo 0)"
    if [ "$dont_count" -eq 0 ]; then
      labels[I3]="uncertain"  # No Don't rules — scorer behavior depends on implementation
    elif [ "$because_count" -gt 0 ]; then
      labels[I3]="pass"
    else
      labels[I3]="fail"
    fi
  else
    labels[I3]="na"
  fi

  # I4: Action-oriented headings
  if [ -n "$entry" ]; then
    labels[I4]="uncertain"  # Complex heading analysis, mark for manual review
  else
    labels[I4]="na"
  fi

  # I5: No identity language
  if [ -n "$entry" ]; then
    identity_hits="$(grep -ciE 'you are a|act as a|your role is|behave as|you should always' "${repo_dir}/${entry}" 2>/dev/null || echo 0)"
    if [ "$identity_hits" -eq 0 ]; then labels[I5]="pass"; else labels[I5]="fail"; fi
  else
    labels[I5]="na"
  fi

  # I6: Entry file length (uncertain — depends on reference range)
  if [ -n "$entry" ]; then
    labels[I6]="uncertain"
  else
    labels[I6]="na"
  fi

  # I7: Entry file < 40K chars
  if [ -n "$entry" ]; then
    char_count="$(wc -c < "${repo_dir}/${entry}" | tr -d '[:space:]')"
    if [ "${char_count:-0}" -lt 40000 ]; then labels[I7]="pass"; else labels[I7]="fail"; fi
  else
    labels[I7]="na"
  fi

  # W1: Build/test commands documented
  if [ -n "$entry" ]; then
    cmd_count="$(grep -cE '`[^`]*(npm|yarn|pnpm|pytest|make|cargo|go |pip |poetry |uv |docker|bun )' "${repo_dir}/${entry}" 2>/dev/null || echo 0)"
    if [ "$cmd_count" -gt 0 ]; then labels[W1]="pass"; else labels[W1]="fail"; fi
  else
    labels[W1]="na"
  fi

  # W2: CI exists
  wf_count="$(find "${repo_dir}/.github/workflows" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null | wc -l | tr -d '[:space:]')"
  if [ "${wf_count:-0}" -gt 0 ]; then labels[W2]="pass"; else labels[W2]="fail"; fi

  # W3: Tests exist
  test_count="$(find "${repo_dir}" -type f \
    -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/__pycache__/*' \
    -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/vendor/*' \
    2>/dev/null | grep -cE '/tests/|/test/|/__tests__/|/spec/|\.test\.|\.spec\.' || echo 0)"
  if [ "${test_count:-0}" -gt 0 ]; then labels[W3]="pass"; else labels[W3]="fail"; fi

  # W4: Linter configured
  linter_found=0
  for lf in ".eslintrc" ".eslintrc.js" ".eslintrc.json" ".eslintrc.yml" "eslint.config.js" "eslint.config.mjs" ".prettierrc" ".prettierrc.json" "pyrightconfig.json" ".rubocop.yml" ".golangci.yml"; do
    [ -f "${repo_dir}/${lf}" ] && linter_found=1 && break
  done
  if [ "$linter_found" -eq 0 ] && [ -f "${repo_dir}/pyproject.toml" ]; then
    grep -q '\[tool\.ruff\]' "${repo_dir}/pyproject.toml" 2>/dev/null && linter_found=1
  fi
  if [ "$linter_found" -eq 1 ]; then labels[W4]="pass"; else labels[W4]="fail"; fi

  # W5: No oversized source files
  oversized="$(find "${repo_dir}" -type f -size +262144c \
    -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/dist/*' \
    -not -path '*/build/*' -not -path '*/vendor/*' \
    -not -name 'package-lock.json' -not -name 'yarn.lock' -not -name '*.lock' \
    \( -name '*.js' -o -name '*.ts' -o -name '*.py' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.json' -o -name '*.yaml' -o -name '*.yml' -o -name '*.md' -o -name '*.sh' \) \
    2>/dev/null | wc -l | tr -d '[:space:]')"
  if [ "${oversized:-0}" -eq 0 ]; then labels[W5]="pass"; else labels[W5]="fail"; fi

  # W6: Pre-commit hooks fast (uncertain — would need to actually run the hook)
  if [ -f "${repo_dir}/.git/hooks/pre-commit" ] || [ -f "${repo_dir}/.husky/pre-commit" ]; then
    labels[W6]="uncertain"
  else
    labels[W6]="pass"
  fi

  # C1: Document freshness (uncertain — requires git log analysis, depends on local clone state)
  labels[C1]="uncertain"

  # C2: Handoff file exists
  handoff_found=0
  for hf in HANDOFF.md PROGRESS.md TODO.md; do
    [ -f "${repo_dir}/${hf}" ] && handoff_found=1 && break
  done
  if [ "$handoff_found" -eq 1 ]; then labels[C2]="pass"; else labels[C2]="fail"; fi

  # C3: Changelog has "why"
  if [ -f "${repo_dir}/CHANGELOG.md" ]; then
    cl_lines="$(wc -l < "${repo_dir}/CHANGELOG.md" | tr -d '[:space:]')"
    if [ "${cl_lines:-0}" -gt 5 ]; then labels[C3]="pass"; else labels[C3]="fail"; fi
  else
    labels[C3]="fail"
  fi

  # C4: Plans in repo
  plans_found=0
  for pd in "docs/plans" ".claude/plans" "plans" "docs/exec-plans"; do
    [ -d "${repo_dir}/${pd}" ] && plans_found=1 && break
  done
  if [ "$plans_found" -eq 1 ]; then labels[C4]="pass"; else labels[C4]="fail"; fi

  # C5: CLAUDE.local.md not tracked
  if git -C "${repo_dir}" ls-files --error-unmatch "CLAUDE.local.md" >/dev/null 2>&1; then
    labels[C5]="fail"
  else
    labels[C5]="pass"
  fi

  # S1: .env in .gitignore
  if git -C "${repo_dir}" ls-files --error-unmatch ".env" >/dev/null 2>&1; then
    labels[S1]="fail"  # .env is tracked
  elif grep -qE '^\s*\.env\s*$|^\s*\.env\b' "${repo_dir}/.gitignore" 2>/dev/null; then
    labels[S1]="pass"
  else
    labels[S1]="fail"
  fi

  # S2: Actions SHA pinned
  if [ "${wf_count:-0}" -eq 0 ]; then
    labels[S2]="pass"  # No actions = OK
  else
    unpinned="$(grep -rhE 'uses:\s*\S+' "${repo_dir}/.github/workflows/" 2>/dev/null | grep -cvE '@[0-9a-f]{40}' || echo 0)"
    if [ "${unpinned:-0}" -eq 0 ]; then labels[S2]="pass"; else labels[S2]="fail"; fi
  fi

  # S3: Secret scanning configured
  if [ -f "${repo_dir}/.gitleaks.toml" ] || grep -q 'gitleaks\|detect-secrets' "${repo_dir}/.pre-commit-config.yaml" 2>/dev/null; then
    labels[S3]="pass"
  else
    labels[S3]="fail"
  fi

  # S4: SECURITY.md exists
  if [ -f "${repo_dir}/SECURITY.md" ]; then labels[S4]="pass"; else labels[S4]="fail"; fi

  # S5: Workflow permissions minimized
  if [ "${wf_count:-0}" -eq 0 ]; then
    labels[S5]="pass"
  else
    overperm=0
    for wf in "${repo_dir}/.github/workflows/"*.yml "${repo_dir}/.github/workflows/"*.yaml; do
      [ -f "$wf" ] || continue
      # Check for contents: write before the jobs: line
      in_top=true
      while IFS= read -r line; do
        case "$line" in jobs:*) in_top=false ;; esac
        if $in_top; then
          case "$line" in *"contents: write"*) overperm=$((overperm + 1)); break ;; esac
        fi
      done < "$wf"
    done
    if [ "$overperm" -eq 0 ]; then labels[S5]="pass"; else labels[S5]="fail"; fi
  fi

  # S6: No hardcoded secrets
  if git -C "${repo_dir}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    secret_hits="$(git -C "${repo_dir}" grep -lE \
      'sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16}|-----BEGIN.*(PRIVATE|RSA|EC) KEY' \
      -- '*.js' '*.ts' '*.py' '*.go' '*.rs' '*.java' '*.sh' '*.yml' '*.yaml' '*.json' '*.toml' \
      ':!*.env' ':!*.env.*' ':!*.lock' \
      2>/dev/null | grep -cv 'node_modules\|\.git\|vendor\|dist\|build' || echo 0)"
    if [ "${secret_hits:-0}" -eq 0 ]; then labels[S6]="pass"; else labels[S6]="fail"; fi
  else
    labels[S6]="uncertain"
  fi

  # Emit JSON for this repo
  if [ "$first" = true ]; then first=false; else printf ',\n' >> "$OUTPUT"; fi
  printf '  {\n    "repo": "%s",\n    "labels": {\n' "$repo_name" >> "$OUTPUT"
  label_first=true
  for check in F1 F2 F3 F4 F5 F6 F7 I1 I2 I3 I4 I5 I6 I7 W1 W2 W3 W4 W5 W6 C1 C2 C3 C4 C5 S1 S2 S3 S4 S5 S6; do
    if [ "$label_first" = true ]; then label_first=false; else printf ',\n' >> "$OUTPUT"; fi
    printf '      "%s": "%s"' "$check" "${labels[$check]:-uncertain}" >> "$OUTPUT"
  done
  printf '\n    }\n  }' >> "$OUTPUT"

  # Count labels
  p=0; f=0; u=0; n=0
  for check in F1 F2 F3 F4 F5 F6 F7 I1 I2 I3 I4 I5 I6 I7 W1 W2 W3 W4 W5 W6 C1 C2 C3 C4 C5 S1 S2 S3 S4 S5 S6; do
    case "${labels[$check]:-uncertain}" in
      pass) p=$((p+1)) ;; fail) f=$((f+1)) ;; uncertain) u=$((u+1)) ;; na) n=$((n+1)) ;;
    esac
  done
  printf '  pass=%d fail=%d uncertain=%d na=%d\n' "$p" "$f" "$u" "$n"

  unset labels
done

printf '\n]\n' >> "$OUTPUT"
echo ""
echo "Labels written to ${OUTPUT}"
echo "Review 'uncertain' labels manually before running accuracy test."
