# Windows Smoke Test

This script runs a cross-platform smoke test for AgentLint with the same Bash entrypoint on Git Bash, macOS, and Linux.
It prints shell diagnostics first so CI failures include the Bash, OS, Node, jq, and Git versions that ran the test.
The test creates isolated temporary git fixtures, then exercises `scanner.sh`, `scorer.js`, `plan-generator.js`, and `reporter.js`.
It also checks that key shell scripts were not checked out with CRLF endings.
When the fixer exposes a safe create-file path, the script verifies the generated file uses LF line endings.
On Git Bash, it reruns the scanner with a Windows-style path to confirm path-form tolerance.
`tests/unit/test-postinstall-detection.js` is the canonical test for `npm/postinstall.js` detection branches; the old Windows-only CI PATH simulation was removed in favor of this deterministic unit test.

Run it locally with:
`bash tests/windows/smoke.sh`

CI will run this from `.github/workflows/ci.yml` in the upcoming Step 6 update.
Requirements: `bash`, `jq`, `git`, and `node` 20 or newer.
On Windows, use Git Bash or WSL so the Bash-based tooling matches CI expectations.
