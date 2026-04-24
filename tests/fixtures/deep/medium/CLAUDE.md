# MediumFixture

A mid-size entry file for deep-analyzer fixture tests. Large enough to
exercise the prompt-sizing branches in `src/deep-analyzer.js` without
requiring a real 10K-character CLAUDE.md.

## Project Context

This fixture simulates a typical small-to-medium project with a handful
of workflow rules and a couple of security-minded constraints. None of
the content is real — it's here so the analyzer has something to build
its D1/D2/D3 prompts against.

## Workflow

- Always run `npm test` before committing.
- Never push to `main` directly; open a PR.
- Prefer one logical change per commit.
- Keep commit messages short but descriptive.

## Style

- Use TypeScript for new code.
- Avoid magic numbers; extract into named constants.
- Write a short docstring for every exported function.

## Handoff

- Update `HANDOFF.md` before ending a session.
- Capture the current branch, todo list, and any blockers.

## Security

- Never hardcode API tokens. Use environment variables.
- Do not print secret values to stdout in debug logs.

## Fixture note

This file is intentionally mundane — deep-analyzer fixture tests check
that the analyzer produces well-formed prompts and JSONL output, not
that the AI actually finds anything worth flagging.
