#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="apply"
CONFIG="${ROOT}/.github/branch-protection.yml"

case "${1:-}" in
  --verify)
    MODE="verify"
    CONFIG="${2:-$CONFIG}"
    ;;
  --apply)
    MODE="apply"
    CONFIG="${2:-$CONFIG}"
    ;;
  -*)
    echo "Usage: $0 [--apply|--verify] [path/to/branch-protection.yml]" >&2
    exit 2
    ;;
  "")
    ;;
  *)
    CONFIG="$1"
    ;;
esac

command -v gh >/dev/null 2>&1 || { echo "gh CLI is required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }

payload="$(mktemp)"
actual="$(mktemp)"
trap 'rm -f "$payload" "$actual"' EXIT

read -r repo branch < <(python3 - "$CONFIG" "$payload" <<'PY'
import json
import sys

config_path, payload_path = sys.argv[1], sys.argv[2]
repo = ''
branch = ''
strict = True
contexts = []
in_contexts = False

with open(config_path, encoding='utf-8') as f:
    for raw_line in f:
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        if stripped.startswith('repository:'):
            repo = stripped.split(':', 1)[1].strip()
            in_contexts = False
        elif stripped.startswith('branch:'):
            branch = stripped.split(':', 1)[1].strip()
            in_contexts = False
        elif stripped.startswith('strict:'):
            strict = stripped.split(':', 1)[1].strip().lower() == 'true'
            in_contexts = False
        elif stripped == 'contexts:':
            in_contexts = True
        elif in_contexts and stripped.startswith('- '):
            contexts.append(stripped[2:].strip())
        elif not raw_line.startswith(' '):
            in_contexts = False

if not repo or not branch or not contexts:
    raise SystemExit(f'{config_path}: repository, branch, and contexts are required')

with open(payload_path, 'w', encoding='utf-8') as f:
    json.dump(dict(strict=strict, contexts=contexts), f)

print(repo, branch)
PY
)

if [ "$MODE" = "verify" ]; then
  echo "Verifying branch protection for ${repo}:${branch} against ${CONFIG}" >&2
  gh api "repos/${repo}/branches/${branch}/protection" > "$actual"
  python3 - "$CONFIG" "$payload" "$actual" <<'PY'
import json
import sys

config_path, expected_path, actual_path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(expected_path, encoding='utf-8') as f:
    expected = json.load(f)
with open(actual_path, encoding='utf-8') as f:
    actual = json.load(f)

required = actual.get('required_status_checks')
if not isinstance(required, dict):
    raise SystemExit(f'{config_path}: live branch protection has no required_status_checks block')

expected_strict = bool(expected.get('strict'))
actual_strict = bool(required.get('strict'))
expected_contexts = sorted(expected.get('contexts') or [])
actual_contexts = sorted(required.get('contexts') or [])

if actual_strict != expected_strict:
    raise SystemExit(
        f'{config_path}: strict mismatch: expected {expected_strict}, live {actual_strict}'
    )

missing = [ctx for ctx in expected_contexts if ctx not in actual_contexts]
extra = [ctx for ctx in actual_contexts if ctx not in expected_contexts]
if missing or extra:
    lines = [f'{config_path}: required status checks differ from live branch protection']
    if missing:
        lines.append('missing live checks: ' + ', '.join(missing))
    if extra:
        lines.append('extra live checks: ' + ', '.join(extra))
    raise SystemExit('\n'.join(lines))

print('branch protection matches declared required status checks')
PY
else
  echo "Applying required status checks to ${repo}:${branch} from ${CONFIG}" >&2
  gh api \
    --method PATCH \
    "repos/${repo}/branches/${branch}/protection/required_status_checks" \
    --input "$payload"
fi
