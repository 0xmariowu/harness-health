#!/usr/bin/env bash
# bootstrap.sh — Initialize project automation from templates
# Usage: bootstrap.sh --lang <ts|python> [--runner bun] [--visibility public|private] [--workflows-only] <project-path>

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BOLD='\033[1m'; NC='\033[0m'

TEMPLATE_DIR="$(cd "$(dirname "$0")/.." && pwd)/templates"

die()  { printf "${RED}error:${NC} %s\n" "$*" >&2; exit 1; }
info() { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$*"; }

# Fail clearly when a flag is missing its value. `set -euo pipefail` alone
# would trip on `$2: unbound variable` — a confusing shell-level error for
# a user-level mistake. Takes the flag name (for the message) and the
# candidate value (pass `${2-}` so unset doesn't blow up on the caller side).
require_value() {
  local flag="$1"
  local value="${2-}"
  [[ -n "$value" ]] || die "agentlint setup: $flag requires a value"
}

# --- Parse args ---
LANG=""; RUNNER=""; WORKFLOWS_ONLY=false; VISIBILITY="private"; PROJECT=""
PKG_MANAGER_OVERRIDE=""; NO_INSTALL=false; FORCE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --lang)           require_value --lang "${2-}"; LANG="$2"; shift 2 ;;
    --runner)         require_value --runner "${2-}"; RUNNER="$2"; shift 2 ;;
    --workflows-only) WORKFLOWS_ONLY=true; shift ;;
    --visibility)     require_value --visibility "${2-}"; VISIBILITY="$2"; shift 2 ;;
    --pkg-manager)    require_value --pkg-manager "${2-}"; PKG_MANAGER_OVERRIDE="$2"; shift 2 ;;
    --no-install)     NO_INSTALL=true; shift ;;
    --force)          FORCE=true; shift ;;
    -*)               die "unknown flag: $1" ;;
    *)                PROJECT="$1"; shift ;;
  esac
done

# RUNNER is accepted as --runner today but not yet consumed (reserved for a
# future bun vs node switch — keeps the advertised flag compatible for users
# who copied older docs). Export to mark it "used" for shellcheck and for any
# future hook that wants to read it without another parser pass.
export RUNNER

[[ -z "$LANG" ]] && die "usage: bootstrap.sh --lang <ts|python|node> [--runner bun] [--visibility public|private] [--workflows-only] [--pkg-manager <auto|npm|pnpm|yarn|bun>] [--no-install] [--force] <project-path>"
[[ -z "$PROJECT" ]] && die "project path required"
[[ "$LANG" != "ts" && "$LANG" != "python" && "$LANG" != "node" ]] && die "lang must be 'ts', 'python', or 'node'"
[[ "$VISIBILITY" != "public" && "$VISIBILITY" != "private" ]] && die "--visibility must be 'public' or 'private'"
[[ -n "$PKG_MANAGER_OVERRIDE" ]] \
  && [[ "$PKG_MANAGER_OVERRIDE" != "auto" && "$PKG_MANAGER_OVERRIDE" != "npm" \
        && "$PKG_MANAGER_OVERRIDE" != "pnpm" && "$PKG_MANAGER_OVERRIDE" != "yarn" \
        && "$PKG_MANAGER_OVERRIDE" != "bun" ]] \
  && die "--pkg-manager must be one of: auto, npm, pnpm, yarn, bun"
[[ ! -d "$PROJECT" ]] && die "not a directory: $PROJECT"

PROJECT="$(cd "$PROJECT" && pwd)"
PROJECT_NAME="$(basename "$PROJECT")"

# Auto-init if the target isn't a git repo yet.
if [[ ! -d "$PROJECT/.git" ]]; then
  warn "target is not a git repo — running 'git init'"
  git -C "$PROJECT" init --initial-branch=main 2>/dev/null || git -C "$PROJECT" init
fi

# Detect the JS package manager by sniffing lockfiles. Modern monorepos use
# pnpm / bun / yarn v2+ which introduce protocols (`workspace:`, `catalog:`)
# that plain npm cannot parse — running `npm install` in such a repo aborts
# bootstrap halfway. Detection lets us defer install to the right tool (or
# skip entirely and let the user run it).
detect_js_pm() {
  [[ -f "$PROJECT/bun.lock"    || -f "$PROJECT/bun.lockb" ]] && { echo bun;  return; }
  [[ -f "$PROJECT/pnpm-lock.yaml" ]]                         && { echo pnpm; return; }
  [[ -f "$PROJECT/yarn.lock" ]]                              && { echo yarn; return; }
  echo npm
}

# Pre-compute template-instantiation values.
case "$LANG" in
  ts|node)
    if [[ -n "$PKG_MANAGER_OVERRIDE" && "$PKG_MANAGER_OVERRIDE" != "auto" ]]; then
      PKG_MANAGER="$PKG_MANAGER_OVERRIDE"
    else
      PKG_MANAGER="$(detect_js_pm)"
    fi
    ;;
  python)
    PKG_MANAGER="pip"
    ;;
  *)
    PKG_MANAGER=""
    ;;
esac
info "detected package manager: $PKG_MANAGER"

# Invoke the detected PM. Exposed as a function so the three install sites
# below stay readable. Any arguments are forwarded verbatim after 'install'.
# shellcheck disable=SC2120 # callers pass no args today; $@ stays for future wiring
pm_install() {
  case "$PKG_MANAGER" in
    npm)  npm install --no-audit --no-fund "$@" ;;
    pnpm) pnpm install "$@" ;;
    yarn) yarn install "$@" ;;
    bun)  bun install "$@" ;;
    *)    warn "pm_install called with unsupported manager '$PKG_MANAGER' — skipping"; return 0 ;;
  esac
}

# Add dev-dependencies using the detected PM. Falls back to a no-op + warn
# when --no-install is set or when the PM binary isn't on PATH.
pm_add_dev() {
  local pkgs=("$@")
  [[ ${#pkgs[@]} -eq 0 ]] && return 0
  if [[ "$NO_INSTALL" == true ]]; then
    warn "--no-install set; skipping install of: ${pkgs[*]}"
    warn "  run later: $PKG_MANAGER add -D ${pkgs[*]}"
    return 0
  fi
  if ! command -v "$PKG_MANAGER" >/dev/null 2>&1; then
    warn "$PKG_MANAGER not on PATH; skipping install of: ${pkgs[*]}"
    warn "  install $PKG_MANAGER first, then: $PKG_MANAGER add -D ${pkgs[*]}"
    return 0
  fi
  case "$PKG_MANAGER" in
    npm)  npm install --save-dev --no-audit --no-fund "${pkgs[@]}" ;;
    pnpm) pnpm add -D "${pkgs[@]}" ;;
    yarn) yarn add -D "${pkgs[@]}" ;;
    bun)  bun add -d "${pkgs[@]}" ;;
  esac
}

# Check whether a package is already declared (dep or devDep). Uses Node to
# parse package.json so we don't depend on the target's PM being installed —
# particularly important before we know whether pnpm/bun/yarn are on PATH.
pm_has_pkg() {
  local pkg="$1"
  [[ -f "$PROJECT/package.json" ]] || return 1
  node -e "
    const p = require('$PROJECT/package.json');
    const all = {...(p.dependencies||{}), ...(p.devDependencies||{}), ...(p.peerDependencies||{})};
    process.exit(all['$pkg'] ? 0 : 1);
  " 2>/dev/null
}
AUTO_OWNER="${GITHUB_OWNER:-}"
if [[ -z "$AUTO_OWNER" ]]; then
  AUTO_OWNER=$(cd "$PROJECT" && gh repo view --json owner -q '.owner.login' 2>/dev/null || echo "")
fi
# Fallback: parse owner from the `origin` remote URL. Covers the common case
# where the repo has a git remote set but the user isn't `gh auth login`-ed
# yet (fresh clones, CI runners, sandboxed environments).
if [[ -z "$AUTO_OWNER" ]]; then
  remote_url=$(git -C "$PROJECT" remote get-url origin 2>/dev/null || echo "")
  # Matches git@github.com:foo/bar.git, https://github.com/foo/bar(.git), ssh://git@github.com/foo/bar
  AUTO_OWNER=$(printf '%s\n' "$remote_url" | sed -nE 's#.*[/:]([^/:]+)/[^/]+(\.git)?/?$#\1#p')
fi

# PROJECT_DOMAIN is a user-overridable substitution token for projects that
# customise the bundled SECURITY.md / CODE_OF_CONDUCT.md to point at a
# dedicated security@<domain>. The stock templates now use GitHub security
# advisories instead, so this stays empty unless the user sets it.
AUTO_PROJECT_DOMAIN="${PROJECT_DOMAIN:-}"

# Replace placeholder tokens inside a newly-copied template with runtime values.
# Tokens are written in `__TOKEN__` form (double-underscore delimited) so that
# bare words like `OWNER` or `LANGUAGE` that appear in scripts as shell
# variable names can never be mistaken for placeholders by a downstream
# search/replace tool. __OWNER__ may still be empty (no gh auth, no remote) —
# in that case the placeholder is left intact so the final summary can prompt
# the user to edit.
instantiate_placeholders() {
  local file="$1"
  [ -f "$file" ] || return 0
  python3 - "$file" "$PROJECT_NAME" "$LANG" "$PKG_MANAGER" "$AUTO_OWNER" "$AUTO_PROJECT_DOMAIN" <<'PY'
import sys
p, proj, lang, pkg, owner, domain = sys.argv[1:7]
with open(p) as f: c = f.read()
if proj:   c = c.replace("__PROJECT_NAME__",    proj)
if lang:   c = c.replace("__LANGUAGE__",        lang)
if pkg:    c = c.replace("__PACKAGE_MANAGER__", pkg)
if owner:  c = c.replace("__OWNER__",           owner)
if domain: c = c.replace("__PROJECT_DOMAIN__",  domain)
with open(p, 'w') as f: f.write(c)
PY
}

printf "\n${BOLD}Bootstrapping ${PROJECT_NAME} (${LANG})${NC}\n\n"

# --- 1. Workflows ---
mkdir -p "$PROJECT/.github/workflows"

copy_workflow() {
  local src="$1" label="$2"
  [[ -e "$src" ]] || return 0
  # Split declaration from assignment so `basename` failures surface (SC2155).
  local dest
  dest="$PROJECT/.github/workflows/$(basename "$src")"
  if [[ -e "$dest" ]]; then
    info "skipped workflow: $(basename "$src") (exists)"
  else
    cp "$src" "$dest"
    info "workflow: $(basename "$src")${label:+ ($label)}"
  fi
}

# Universal workflows
for f in "$TEMPLATE_DIR/universal/"*.yml; do
  copy_workflow "$f" ""
done

# Language-specific workflows (empty directory is fine — e.g., node pack)
for f in "$TEMPLATE_DIR/$LANG/"*.yml; do
  copy_workflow "$f" "$LANG"
done

# Composite actions
if [[ -d "$TEMPLATE_DIR/workflows/actions" ]]; then
  mkdir -p "$PROJECT/.github/actions"
  for action_dir in "$TEMPLATE_DIR/workflows/actions/"*/; do
    [[ -d "$action_dir" ]] || continue
    action_name="$(basename "$action_dir")"
    dest="$PROJECT/.github/actions/$action_name"
    if [[ -e "$dest" ]]; then
      info "skipped action: $action_name (exists)"
    else
      cp -R "$action_dir" "$dest"
      info "action: $action_name"
    fi
  done
else
  info "skip workflow actions copy: workflows/actions not present"
fi

# --- 1b. Public repo config (PII protection) ---
if [[ "$VISIBILITY" == "public" ]]; then
  cp "$TEMPLATE_DIR/configs/.gitleaks.toml" "$PROJECT/.gitleaks.toml"
  cp "$TEMPLATE_DIR/configs/.gitleaks.toml.template" "$PROJECT/.gitleaks.toml.template"
  info ".gitleaks.toml (PII + base rules)"
  info ".gitleaks.toml.template (project-specific codename rules; edit this file per project)"

  if [[ -n "$AUTO_OWNER" ]]; then
    existing_user_email=$(git -C "$PROJECT" config --local --get user.email || true)
    existing_user_name=$(git -C "$PROJECT" config --local --get user.name || true)

    if [[ -n "$existing_user_email" ]]; then
      info "git user.email already set, keeping existing value"
    fi
    if [[ -n "$existing_user_name" ]]; then
      info "git user.name already set, keeping existing value"
    fi

    if [[ -z "$existing_user_email" && -z "$existing_user_name" ]]; then
      git -C "$PROJECT" config --local user.email "${AUTO_OWNER}@users.noreply.github.com"
      git -C "$PROJECT" config --local user.name "$AUTO_OWNER"
      info "git user.email/user.name set to detected owner '${AUTO_OWNER}'"
    fi
  else
    info "Skipped repo-local user config. Set user.email/user.name manually (for commits, use a repository-specific value)."
  fi

  warn "PUBLIC REPO: PII scanning active. Internal codenames will be flagged by gitleaks."

  # Enable auto-delete head branches to prevent stale PII-containing branches
  REPO_OWNER=${AUTO_OWNER:-$(gh repo view --json owner -q '.owner.login' 2>/dev/null || echo "")}
  if [ -n "$REPO_OWNER" ]; then
    gh api "repos/$REPO_OWNER/$PROJECT_NAME" -X PATCH --field delete_branch_on_merge=true 2>/dev/null && \
      info "auto-delete head branches enabled" || \
      warn "could not enable auto-delete branches (set manually in Settings)"
  fi
fi

# --- 1c. .dockerignore for Python (if Dockerfile exists or likely) ---
if [[ "$LANG" == "python" ]] && [[ ! -f "$PROJECT/.dockerignore" ]]; then
  cp "$TEMPLATE_DIR/configs/python/.dockerignore" "$PROJECT/.dockerignore"
  info ".dockerignore (prevents secrets/state in Docker builds)"
fi

# --- 1d. Universal root-level hygiene files ---
# Normalize line endings across platforms so Windows contributors don't produce CRLF diffs.
if [[ ! -f "$PROJECT/.gitattributes" ]] && [[ -f "$TEMPLATE_DIR/.gitattributes" ]]; then
  cp "$TEMPLATE_DIR/.gitattributes" "$PROJECT/.gitattributes"
  info ".gitattributes (eol=lf + binary markers)"
fi
# ShellCheck defaults so `shellcheck script.sh` uses the same rules CI does.
if [[ ! -f "$PROJECT/.shellcheckrc" ]] && [[ -f "$TEMPLATE_DIR/.shellcheckrc" ]]; then
  cp "$TEMPLATE_DIR/.shellcheckrc" "$PROJECT/.shellcheckrc"
  info ".shellcheckrc (severity=warning)"
fi

# --- 1e. Language-specific root configs ---
if [[ "$LANG" == "ts" || "$LANG" == "node" ]]; then
  if [[ ! -f "$PROJECT/.nvmrc" ]] && [[ -f "$TEMPLATE_DIR/configs/ts/.nvmrc" ]]; then
    cp "$TEMPLATE_DIR/configs/ts/.nvmrc" "$PROJECT/.nvmrc"
    info ".nvmrc (pins Node version for nvm users)"
  fi
fi
if [[ "$LANG" == "python" ]]; then
  # pyproject.toml template — only drop it in when the project has no pyproject yet.
  # Existing projects manage their own; template is a starting point for greenfield repos.
  if [[ ! -f "$PROJECT/pyproject.toml" ]] && [[ -f "$TEMPLATE_DIR/configs/python/pyproject.toml.template" ]]; then
    cp "$TEMPLATE_DIR/configs/python/pyproject.toml.template" "$PROJECT/pyproject.toml"
    instantiate_placeholders "$PROJECT/pyproject.toml"
    info "pyproject.toml (ruff + pytest markers + pyright defaults)"
  fi
  if [[ ! -f "$PROJECT/pyrightconfig.json" ]] && [[ -f "$TEMPLATE_DIR/configs/python/pyrightconfig.json" ]]; then
    cp "$TEMPLATE_DIR/configs/python/pyrightconfig.json" "$PROJECT/pyrightconfig.json"
    info "pyrightconfig.json"
  fi
fi

# Early exit if --workflows-only: skip GitHub config, AI-friendly docs, hooks, pre-commit stack.
if [[ "$WORKFLOWS_ONLY" == true ]]; then
  printf "\n${BOLD}Done (workflows only).${NC}\n"
  exit 0
fi

# --- 2. GitHub config (CODEOWNERS, PR template, issue templates, SECURITY.md, doc templates) ---
# Non-destructive by default: skip files that already exist. `--force` overwrites.
# Rationale: setup is high-trust, it writes into user repositories. Overwriting
# a project's CODEOWNERS or PR template without opt-in is a silent scope creep.
copy_guarded() {
  local src="$1" dest="$2" label="$3"
  if [[ -f "$dest" && "$FORCE" != true ]]; then
    info "$label exists, skipping (use --force to overwrite)"
    return 0
  fi
  cp "$src" "$dest"
  info "$label"
}

copy_guarded "$TEMPLATE_DIR/configs/github/CODEOWNERS" \
             "$PROJECT/.github/CODEOWNERS" \
             ".github/CODEOWNERS"

copy_guarded "$TEMPLATE_DIR/configs/github/pull_request_template.md" \
             "$PROJECT/.github/pull_request_template.md" \
             ".github/pull_request_template.md"

mkdir -p "$PROJECT/.github/ISSUE_TEMPLATE"
for f in "$TEMPLATE_DIR/configs/github/ISSUE_TEMPLATE/"*; do
  dest="$PROJECT/.github/ISSUE_TEMPLATE/$(basename "$f")"
  if [[ -f "$dest" && "$FORCE" != true ]]; then
    info ".github/ISSUE_TEMPLATE/$(basename "$f") exists, skipping (use --force to overwrite)"
    continue
  fi
  cp "$f" "$dest"
  instantiate_placeholders "$dest"
  info ".github/ISSUE_TEMPLATE/$(basename "$f")"
done

for template_doc in CONTRIBUTING.md CODE_OF_CONDUCT.md RELEASING.md SECURITY.md; do
  if [[ ! -f "$PROJECT/$template_doc" && -f "$TEMPLATE_DIR/configs/$template_doc" ]]; then
    cp "$TEMPLATE_DIR/configs/$template_doc" "$PROJECT/$template_doc"
    instantiate_placeholders "$PROJECT/$template_doc"
    info "$template_doc"
  fi
done

# --- 2d. AI-friendly scaffold templates ---
for template_doc in CLAUDE.md HANDOFF.md CHANGELOG.md; do
  if [[ ! -f "$PROJECT/$template_doc" ]]; then
    cp "$TEMPLATE_DIR/configs/templates/$template_doc" "$PROJECT/$template_doc"
    instantiate_placeholders "$PROJECT/$template_doc"
    info "$template_doc (AI-friendly template)"
  fi
done

if [[ ! -f "$PROJECT/INDEX.jsonl.example" ]]; then
  cp "$TEMPLATE_DIR/configs/templates/INDEX.jsonl.example" "$PROJECT/INDEX.jsonl.example"
  info "INDEX.jsonl.example"
fi

mkdir -p "$PROJECT/docs"
if [[ ! -f "$PROJECT/docs/rules-style.md" ]]; then
  cp "$TEMPLATE_DIR/configs/rules-style.md" "$PROJECT/docs/rules-style.md"
  info "docs/rules-style.md (AI rule style guide)"
fi

if [[ ! -f "$PROJECT/docs/ship-boundary.md" ]]; then
  cp "$TEMPLATE_DIR/configs/ship-boundary.md" "$PROJECT/docs/ship-boundary.md"
  info "docs/ship-boundary.md (ship/local/never file-provenance boundary)"
fi

# --- 3. Generate labeler config ---
# Generate-once only: rerunning bootstrap must not churn the file, because
# vibekit creates `scripts/` itself during the first run, which would flip the
# auto-detected content on a second run and produce a committed-file diff the
# user didn't ask for.
LABELER="$PROJECT/.github/labeler.yml"
if [[ ! -f "$LABELER" ]]; then
  {
    # `core` = application code. Candidate dir names span ecosystems:
    #   src/ lib/    — JS/TS/Rust
    #   app/         — Rails / Next.js
    #   pkg/ cmd/ internal/ — Go
    #   Sources/     — Swift
    core_matched=0
    for dir in src lib app pkg cmd internal Sources; do
      if [[ -d "$PROJECT/$dir" ]]; then
        printf "core:\n  - changed-files:\n      - any-glob-to-any-file: ['%s/**']\n\n" "$dir"
        core_matched=1
      fi
    done
    # No source dir exists yet (fresh repo, scaffold-only). Emit a sensible
    # default so the labeler still runs — the user can trim the globs later.
    # Without this fallback, labeler.yml ships with no `core:` section and
    # every PR that touches source code is silently mis-labeled.
    if [[ $core_matched -eq 0 ]]; then
      printf "core:\n  - changed-files:\n      - any-glob-to-any-file: ['src/**', 'lib/**']\n\n"
    fi

    for dir in tests test __tests__ spec Tests; do
      [[ -d "$PROJECT/$dir" ]] && printf "tests:\n  - changed-files:\n      - any-glob-to-any-file: ['${dir}/**']\n\n"
    done

    for dir in scripts bin; do
      [[ -d "$PROJECT/$dir" ]] && printf "scripts:\n  - changed-files:\n      - any-glob-to-any-file: ['${dir}/**']\n\n"
    done

    for dir in docs doc; do
      [[ -d "$PROJECT/$dir" ]] && printf "docs:\n  - changed-files:\n      - any-glob-to-any-file: ['${dir}/**']\n\n"
    done

    printf "ci:\n  - changed-files:\n      - any-glob-to-any-file: ['.github/**']\n"
  } > "$LABELER"
  info "generated: .github/labeler.yml"
else
  info "skipped: .github/labeler.yml (already exists)"
fi

# --- 4. Hooks ---

# Committer script + husky + commitlint — TS/node only. Python projects
# route commit-gate through pre-commit + conventional-pre-commit (see
# .pre-commit-config.yaml.template) which is the native Python-ecosystem
# approach and avoids forcing Node + npm on Python-only developer machines.
mkdir -p "$PROJECT/scripts"
cp "$TEMPLATE_DIR/scripts/check-deps.sh" "$PROJECT/scripts/check-deps.sh"
chmod +x "$PROJECT/scripts/check-deps.sh"
info "scripts/check-deps.sh"
cp "$TEMPLATE_DIR/scripts/fill-placeholders.sh" "$PROJECT/scripts/fill-placeholders.sh"
chmod +x "$PROJECT/scripts/fill-placeholders.sh"
info "scripts/fill-placeholders.sh"

if [[ "$LANG" != "python" ]]; then
  cp "$TEMPLATE_DIR/hooks/committer" "$PROJECT/scripts/committer"
  chmod +x "$PROJECT/scripts/committer"
  info "scripts/committer"

  # Husky hooks
  mkdir -p "$PROJECT/.husky"
  for hook in "$TEMPLATE_DIR/hooks/husky/"*; do
    [ -f "$hook" ] || continue
    hook_name="$(basename "$hook")"
    cp "$hook" "$PROJECT/.husky/$hook_name"
    chmod +x "$PROJECT/.husky/$hook_name"
    info ".husky/$hook_name"
  done

  # Commitlint config — use .cjs if project has "type": "module"
  if python3 -c "import json,sys; sys.exit(0 if json.load(open('$PROJECT/package.json')).get('type')=='module' else 1)" 2>/dev/null; then
    cp "$TEMPLATE_DIR/configs/commitlint.config.cjs" "$PROJECT/commitlint.config.cjs"
    info "commitlint.config.cjs (ESM project)"
  else
    cp "$TEMPLATE_DIR/configs/commitlint.config.js" "$PROJECT/commitlint.config.js"
    info "commitlint.config.js"
  fi
fi

# --- 5. Install husky + commitlint ---
cd "$PROJECT"

if [[ ( "$LANG" == "ts" || "$LANG" == "node" ) ]] && [[ ! -f package.json ]]; then
  # Create minimal package.json for husky + commitlint
  cat > package.json <<'PKGJSON'
{
  "private": true,
  "devDependencies": {
    "@commitlint/cli": "^20.5.0",
    "@commitlint/config-conventional": "^20.5.0",
    "husky": "^9.1.7"
  },
  "scripts": {
    "prepare": "husky || true"
  }
}
PKGJSON
  info "generated: package.json (minimal, for husky + commitlint)"
fi

# TS projects: add devDeps if missing
if [[ "$LANG" == "ts" ]] && [[ -f package.json ]]; then
  # Check if husky/commitlint are already declared. `pm_has_pkg` reads
  # package.json directly so detection works regardless of which PM owns
  # the lockfile.
  missing=()
  for pkg in husky @commitlint/cli @commitlint/config-conventional; do
    pm_has_pkg "$pkg" || missing+=("$pkg")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    pm_add_dev "${missing[@]}" && info "installed: ${missing[*]}" || \
      warn "could not install ${missing[*]} — hooks may not work until you run '$PKG_MANAGER add -D ${missing[*]}'"
  else
    info "husky/commitlint already present, skipping install"
  fi

  # Add lint-staged/eslint/prettier if missing
  missing=()
  for pkg in lint-staged eslint prettier; do
    pm_has_pkg "$pkg" || missing+=("$pkg")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    pm_add_dev "${missing[@]}" && info "installed: ${missing[*]}" || \
      warn "could not install ${missing[*]}"
  else
    info "lint-staged/eslint/prettier already present, skipping install"
  fi

  if [[ ! -f vitest.config.ts ]] && grep -q '"vitest"' package.json; then
    cp "$TEMPLATE_DIR/configs/vitest.config.ts.template" ./vitest.config.ts
    info "vitest.config.ts"
  fi

  check_exists=$(LANG_ARG="$LANG" python3 -c "
import json
import os

lang = os.environ.get('LANG_ARG', '')
with open('package.json') as f:
    d = json.load(f)

scripts = d.get('scripts')
if not isinstance(scripts, dict):
    scripts = {}

# Add adaptive scaffold scripts (don't overwrite user's existing entries).
if lang == 'ts':
    scripts.setdefault('typecheck', 'tsc --noEmit')
    scripts.setdefault('format:check', 'prettier --check .')

has_eslint_cfg = any(os.path.exists(f'eslint.config.{ext}') for ext in ('js','mjs','cjs'))
if has_eslint_cfg:
    scripts.setdefault('lint', 'eslint .')

# Build 'check' from scripts that actually exist — referencing an undefined
# script causes npm run check to exit 1 with no signal.
if 'check' in scripts:
    print('exists')
else:
    candidates = ['build', 'typecheck', 'lint', 'format:check', 'test']
    present = [c for c in candidates if c in scripts]
    scripts['check'] = ' && '.join(f'npm run {c}' for c in present) if present else 'echo \"no checks configured\"'
    d['scripts'] = scripts
    with open('package.json', 'w') as f:
        json.dump(d, f, indent=2)
        f.write('\\n')
    print('added:' + scripts['check'])
")
  if [[ "$check_exists" == added:* ]]; then
    info "added scripts.check → ${check_exists#added:}"
  else
    info "scripts.check already present, leaving unchanged"
  fi
  # Inject lint-staged config if missing
  if ! grep -q 'lint-staged' package.json 2>/dev/null || ! python3 -c "import json; d=json.load(open('package.json')); assert 'lint-staged' in d" 2>/dev/null; then
    python3 -c "
import json
import os
with open('package.json') as f:
    d = json.load(f)
if 'lint-staged' not in d:
    # ESLint v9 refuses to run without eslint.config.{js,mjs,cjs}. If the
    # caller already has one, keep eslint in the hook; otherwise prettier-only
    # so every commit doesn't fail until the user writes a flat config.
    has_eslint_cfg = any(os.path.exists(f'eslint.config.{ext}') for ext in ('js','mjs','cjs'))
    ts_cmds = ['eslint --fix', 'prettier --write'] if has_eslint_cfg else ['prettier --write']
    d['lint-staged'] = {
        '*.ts': ts_cmds,
        '*.{json,md,yml,yaml}': ['prettier --write']
    }
    with open('package.json', 'w') as f:
        json.dump(d, f, indent=2)
        f.write('\n')
    note = '' if has_eslint_cfg else ' (prettier-only — no eslint.config.* found)'
    print(f'  added lint-staged config to package.json{note}')
"
  fi
fi

# knip.config.ts was previously copied here unconditionally even though
# `knip` itself was not installed as a devDependency — the resulting config
# was orphaned. Removed the template copy; users who want knip can add it
# themselves (`npm i -D knip && npx knip --init`).

# Install and activate husky — TS/node only. Python projects use pre-commit
# (see the pre-commit-stack block below).
if [[ "$LANG" == "python" ]]; then
  info "Python: commit-gate via pre-commit (no husky / no npm)"
elif [[ "$LANG" == "node" ]] && [[ ! -f package.json ]]; then
  # Node projects without package.json: use git config directly
  git config core.hooksPath .husky
  info "hooks activated via core.hooksPath (no npm)"
elif [[ "$NO_INSTALL" == true ]]; then
  # User asked us not to touch their install state. Wire husky via
  # git config so hooks still fire once they run `$PKG_MANAGER install`.
  git config core.hooksPath .husky
  info "hooks activated via core.hooksPath (--no-install; run '$PKG_MANAGER install' to complete setup)"
else
  # Run the detected PM's install. Modern monorepo PMs (pnpm / bun / yarn
  # berry) understand workspace: / catalog: protocols that npm can't, so
  # using the *target's* PM here avoids the ERESOLVE / EUNSUPPORTEDPROTOCOL
  # aborts we hit with unconditional `npm install` on real repos.
  if command -v "$PKG_MANAGER" >/dev/null 2>&1; then
    if ! pm_install; then
      warn "$PKG_MANAGER install failed — wiring husky via git core.hooksPath as fallback"
      git config core.hooksPath .husky
    fi
  else
    warn "$PKG_MANAGER not on PATH — wiring husky via git core.hooksPath (install $PKG_MANAGER later to enable lint-staged / commitlint)"
    git config core.hooksPath .husky
  fi
  npx --no -- husky 2>/dev/null || true
  # Fallback: if husky didn't set hooksPath, set it directly
  if ! git config core.hooksPath >/dev/null 2>&1; then
    git config core.hooksPath .husky
  fi
  info "husky activated"
fi

# --- 5b. Pre-commit stack (default for templated projects) ---
if [[ ! -f "$PROJECT/.pre-commit-config.yaml" ]]; then
  cp "$TEMPLATE_DIR/configs/.pre-commit-config.yaml.template" "$PROJECT/.pre-commit-config.yaml"
  info ".pre-commit-config.yaml"
else
  info "skipped .pre-commit-config.yaml (already exists)"
fi

if [[ "$LANG" == "python" ]]; then
  info "Python: activate commit hooks with"
  info "    pip install pre-commit && pre-commit install --install-hooks"
  info "  (commit-msg format + file hygiene run on every commit)"
fi

if [[ ! -f "$PROJECT/zizmor.yml" ]]; then
  cp "$TEMPLATE_DIR/configs/zizmor.yml.template" "$PROJECT/zizmor.yml"
  info "zizmor.yml"
else
  info "skipped zizmor.yml (already exists)"
fi

if [[ ! -f "$PROJECT/.secrets.baseline" ]]; then
  cp "$TEMPLATE_DIR/configs/.secrets.baseline.template" "$PROJECT/.secrets.baseline"
  info ".secrets.baseline"
else
  info "skipped .secrets.baseline (already exists)"
fi

# Copy language-specific .gitignore if project doesn't have one
if [[ ! -f .gitignore ]]; then
  cp "$TEMPLATE_DIR/configs/$LANG/gitignore" .gitignore
  info ".gitignore (from $LANG template)"
else
  # Loose match — accept any form of node_modules entry (with/without slash, glob prefix, etc.)
  if ! grep -q 'node_modules' .gitignore; then
    echo 'node_modules/' >> .gitignore
    info ".gitignore: added node_modules/"
  else
    info ".gitignore: verified"
  fi
fi

# --- 6. Summary ---
printf "\n${BOLD}${GREEN}Done!${NC} ${PROJECT_NAME} is now equipped with:\n"
printf "  • %s GitHub Actions workflows\n" "$(find "$PROJECT/.github/workflows" -maxdepth 1 -name '*.yml' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$WORKFLOWS_ONLY" != true ]]; then
  if [[ "$LANG" != "python" ]]; then
    printf "  • pre-commit hook (author whitelist + PII scan + secrets + codenames + lint)\n"
    printf "  • pre-push hook (rebase + test)\n"
    printf "  • commit-msg hook (conventional commit format)\n"
    printf "  • scripts/committer (atomic commit tool)\n"
  else
    printf "  • pre-commit framework wiring (conventional-pre-commit for commit-msg, ruff for .py, hygiene hooks)\n"
  fi
  printf "  • .pre-commit-config.yaml (pre-commit template)\n"
  printf "  • zizmor.yml (Zizmor config baseline)\n"
  printf "  • .secrets.baseline (detect-secrets baseline)\n"
  printf "  • scripts/check-deps.sh (dependency checker)\n"
  printf "  • scripts/fill-placeholders.sh (re-fill __TOKEN__ docs after you add a remote / rename)\n"
fi
if [[ "$VISIBILITY" == "public" ]]; then
  printf "  • .gitleaks.toml (PII rules)\n"
  printf "  • .gitleaks.toml.template (codename rule template)\n"
  printf "  • repo-local git user identity (if owner could be detected)\n"
  printf "  • auto-delete head branches on merge\n"
  printf "  • hygiene.yml (CI: author/codename/path/image checks)\n"
fi
printf "  • CODEOWNERS, PR template, issue templates, SECURITY.md\n"
printf "  • release workflow (tag v* → GitHub Release)\n"
printf "  • docs/ship-boundary.md (file-provenance ship/local/never rules)\n"
if [[ -z "$AUTO_OWNER" ]]; then
  warn "__OWNER__ placeholder left in generated docs — gh owner not detected"
  warn "  Fix: scripts/fill-placeholders.sh --owner <your-handle> . (or edit files by hand)"
fi
# No-op when the stock templates are used (they route security reports via
# GitHub security advisories). Users who customise templates to reference
# security@__PROJECT_DOMAIN__ can export PROJECT_DOMAIN before invoking bootstrap
# (or set it later via scripts/fill-placeholders.sh).

printf "\n${BOLD}Next steps:${NC}\n"
if [[ "$LANG" == "python" ]]; then
  printf "  1. Activate pre-commit: pip install pre-commit && pre-commit install --install-hooks\n"
  printf "  2. git add <files> && git commit -m \"chore: bootstrap vibekit\"\n"
  printf "  3. git push\n"
  printf "  4. Open a test PR to verify CI\n"
  printf "  5. Tag a release: git tag vX.Y.Z && git push --tags\n\n"
else
  printf "  1. Commit the new files (direct \`git commit\` is blocked by the installed pre-commit hook):\n"
  printf "       scripts/committer --all-new \"chore: bootstrap vibekit\"\n"
  printf "  2. git push\n"
  printf "  3. Open a test PR to verify CI\n"
  printf "  4. Tag a release: git tag vX.Y.Z && git push --tags\n\n"
fi
