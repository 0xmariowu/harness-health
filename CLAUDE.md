# Harness Health

> For global rules, see `~/CLAUDE.md`. This file contains harness-health-specific overrides only.
> Lighthouse for AI-Friendly repos — diagnose, plan, fix.

## Session Checklist

1. If modifying checks → read `standards/evidence.json` for evidence backing
2. If modifying scoring → read `standards/weights.json` for weight rationale
3. If adding a check → must have evidence source (paper, data, or real audit finding)

## Rules

- Don't add a check without empirical evidence. Instead, cite: Anthropic data, academic paper, or documented real-world failure. Because: HH's value is evidence-backed recommendations, not opinions.
- Don't hardcode thresholds as pass/fail gates. Instead, measure and compare to reference values. Because: Bitter Lesson — imposing human-defined boundaries creates brittle rules that break when context changes.
- Don't modify scanner output format without updating scorer + plan-generator + reporter. Because: the JSONL schema is a contract between all pipeline stages.
- Don't hardcode paths in skills/*.md. Instead, use `${CLAUDE_PLUGIN_ROOT}` to reference bundled files. Because: plugin install path varies per user.
- Don't write persistent data to `${CLAUDE_PLUGIN_ROOT}`. Instead, use `${CLAUDE_PLUGIN_DATA}` or `~/.hh/`. Because: plugin root is replaced on update.

## Workflow

- Branch: `feature/{desc}`, `fix/{desc}` — don't develop on main
- Commit: `{type}: {description}` (feat/fix/refactor/test/docs/chore)
- One commit = one logical change. Commit sequence: source code first, tests second, docs/config third. Don't batch. Because: reviewers need to verify tests cover exactly the code that changed.
- Feature commits without corresponding test commits will not pass review. Because: untested features are untested assumptions.
- Don't stage `.env*`, credentials, `node_modules/`, `__pycache__/`, or `.git/` internals. Because: these files contain secrets or generated content that must not enter version control.
