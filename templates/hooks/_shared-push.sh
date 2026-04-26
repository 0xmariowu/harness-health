# shellcheck shell=bash
# _shared-push.sh — Sourced by language pre-push hooks.
# Provides: main-branch early exit, ancestry check against origin/main.
# After sourcing, caller runs its test command.
#
# This hook does NOT mutate git state. It used to silently run
# `git pull --rebase` which surprised users mid-commit (lost reflog
# entries, partial rebases when conflicts hit, churn in shared
# branches). Now it just refuses the push and tells the user how to
# update — rebase / merge is a deliberate decision, not a hook side
# effect.

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

branch=$(git rev-parse --abbrev-ref HEAD)

if [ "$branch" = "main" ]; then
  exit 0
fi

git fetch origin main --quiet
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "Push blocked: branch '$branch' does not include the latest origin/main."
  echo "Update via 'git pull --rebase origin main' (or 'git merge origin/main') and try again."
  exit 1
fi
