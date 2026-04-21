# Release Notes Generation Instructions

## Style

- Lead with what USER can DO (not what code changed internally).
- "You can now ..." beats "Refactored ...".
- Group by user-facing category: Features / Bug Fixes / Breaking Changes / Deprecations.
- Keep each entry to one sentence.

## Exclude

- Internal refactors without user impact.
- Test-only changes.
- CI/workflow changes.
- Documentation typo fixes.

## Categorize

- `feat:` commits → **Features** section
- `fix:` commits → **Bug Fixes**
- `BREAKING CHANGE:` footer → **Breaking Changes** section (top)
- `deprecate:` → **Deprecations**
- Other → Omit

## Tone

This is the AgentLint — AI-Friendly repo lighthouse/scanner. Release notes here are mostly developer-focused — features + gate enhancements. Keep tone factual, under 200 words total.