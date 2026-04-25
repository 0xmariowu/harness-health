# Contributing

Thanks for your interest in AgentLint! Here's how to help.

## Reporting bugs

Open an [issue](https://github.com/0xmariowu/agent-lint/issues/new?template=bug_report.yml) with:
- What happened and what you expected
- Steps to reproduce
- Your OS and Node version

## Suggesting features

Open an [issue](https://github.com/0xmariowu/agent-lint/issues/new?template=feature_request.yml) describing the problem you want to solve.

## Pull requests

1. Open an issue first for anything non-trivial
2. Fork the repo, create a branch (`fix/description` or `feature/description`)
3. Make your changes, add tests if applicable
4. Run `bash tests/test-scanner.sh && node tests/test-scorer.js && node tests/test-plan-generator.js && node tests/test-reporter.js && node tests/test-fixer.js`
5. Open a PR against `main`

### What makes a good PR

- One logical change per PR
- Tests for new functionality
- Clear description of what and why

### AI-assisted contributions

AI-assisted PRs are welcome. Please note in the PR description if AI tools were used and what level of manual review was done.

## Development setup

```bash
git clone https://github.com/0xmariowu/agent-lint.git
cd agent-lint
# No npm install needed — no dependencies
bash tests/test-scanner.sh  # verify scanner works
```

Requirements: `bash`, `jq`, `node` 20+

## Maintainer checks

Branch protection is declared in `.github/branch-protection.yml`. Before a
release, an admin should verify the live `main` settings match that file:

```bash
scripts/setup-branch-protection.sh --verify
```

That command uses `gh api repos/.../branches/main/protection` and exits
non-zero if required status checks or strictness drift from the checked-in
contract. Use `scripts/setup-branch-protection.sh --apply` only when you intend
to update the live GitHub settings.
