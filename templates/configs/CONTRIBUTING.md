# Contributing

Thanks for your interest in __PROJECT_NAME__! Here's how to help.

## Reporting bugs

Open an [issue](https://github.com/__OWNER__/__PROJECT_NAME__/issues/new?template=bug_report.yml) with:
- What happened and what you expected
- Steps to reproduce
- Your OS and runtime version

## Suggesting features

Open an [issue](https://github.com/__OWNER__/__PROJECT_NAME__/issues/new?template=feature_request.yml) describing the problem you want to solve.

## Pull requests

1. Open an issue first for anything non-trivial
2. Fork the repo, create a branch (`fix/description` or `feature/description`)
3. Make your changes, add tests if applicable
4. # TODO: project test commands
5. Open a PR against `main`

### What makes a good PR

- One logical change per PR
- Tests for new functionality
- Clear description of what and why

### AI-assisted contributions

AI-assisted PRs are welcome. Please note in the PR description if AI tools were used and what level of manual review was done.

Before you submit, run the **Delete Chat Test**: start a fresh agent session and hand it the same PR description. If it can finish the work using only the repo, the harness is good. If it can't, the missing context belongs in `CLAUDE.md` or a subsystem `CLAUDE.md` before merge — see `configs/rules-style.md` §3.11.

## Development setup

```bash
git clone https://github.com/__OWNER__/__PROJECT_NAME__.git
cd __PROJECT_NAME__
# No npm install needed — no dependencies
bash tests/test-scanner.sh  # verify scanner works
```

Requirements: `bash`, `jq`, `node` 20+
