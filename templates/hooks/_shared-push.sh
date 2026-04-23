# shellcheck shell=bash
# _shared-push.sh — Sourced by language pre-push hooks.
# Provides: main-branch early exit, rebase on origin/main.
# After sourcing, caller runs its test command.

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

branch=$(git rev-parse --abbrev-ref HEAD)

if [ "$branch" = "main" ]; then
  exit 0
fi

git fetch origin main --quiet
if ! git rebase origin/main --quiet; then
  echo "Rebase on main failed — resolve conflicts first."
  git rebase --abort
  exit 1
fi
echo "Rebased on origin/main"
