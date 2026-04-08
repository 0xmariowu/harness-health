# Handoff

## feature/accuracy-benchmark
**What**: Corpus-wide accuracy benchmark — 4,533 repos × 33 checks, 93.9% overall accuracy
**Status**: 11 commits. Ready to push + PR.

**Scanner bugs found by benchmark** (fix in separate PRs — accuracy CI will verify):
- C2: `grep 'status'` matches nearly every CLAUDE.md → 3.5% precision. Fix: check file existence only (HANDOFF.md etc), remove content grep.
- I3: Only matches `Don't` (case-sensitive), misses `Do not`. Because: window only 3 lines. Fix: add `Do not` variant, widen Because window.
- I4: Heading keyword list too narrow (6 words: workflow/session/rules/writing/debugging/how). Fix: expand list (build/test/deploy/setup/install/config/run/development).
- S6: `sk-[a-zA-Z0-9]{20,}` matches `sk-learn`. Fix: add word boundary or exclude known false positives.
- S7: Greps ALL source files for /Users/ paths — catches test fixtures, generated JSON. Fix: exclude test/vendor/generated dirs.

## main (updated 2026-04-05)
**What**: AgentLint v0.4.0 — 33 checks, 5 dimensions, HTML report with before/after comparison
**Status**: Published. CI green. Submitted to 27 awesome lists.

**Next**:
1. Run `/al` in real Claude Code session (full UX verification)
2. Add Safety check fixtures to E2E tests
3. Consider new checks: single-test invocation (I8), shallow clone warning (W7)
4. Add `test-deep-analyzer.sh`, `test-session-analyzer.sh`, `test-install-script.sh` to CI
