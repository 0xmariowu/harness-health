# Privacy Taxonomy — What counts as private information

> Definition document. Answers "is this particular string private?" before any enforcement tool runs.
>
> **Scope**: this taxonomy applies to **everything that reaches `origin` or stays in git history**, not just file contents. That means:
> - file contents in tracked files
> - **commit messages** (subject + body)
> - **commit author metadata** (name + email)
> - **tag names and tag messages**
> - **PR / issue descriptions and comments** that the maintainer controls
>
> This scope is enforced across multiple gates. See the "Enforcement" column below for the one handling each category.

## Three dimensions

Private information falls into one of three orthogonal dimensions:

- **A · Identity** — who this is (the person, the machine, the account)
- **B · Assets** — what this person owns (projects, credentials, paths, business judgement)
- **C · Behavior** — what this person has done (file content, commit messages, timing patterns, scrub history)

Different dimensions leak through different channels, so different gates enforce each one.

## Subcategory table

| Code | Subcategory | Positive examples | Edge case (still OK) | Enforcement |
|---|---|---|---|---|
| **A.1** | Person identity | real name, avatar, personal email | maintainer's public GitHub handle via noreply (e.g. `12345+handle@users.noreply.github.com`) | `author-email.yml` workflow rejects non-noreply emails |
| **A.2** | Machine identity | tailnet hostname (`foo.ts.net`), mDNS local hostname (`MyMac-Studio.local`), internal IP | public product name reference (e.g. "e2b.dev" as a service you may use) | `hygiene.yml` + `commit-message-scan.yml` SB-N-06 |
| **A.3** | Account identity | previous GitHub handle, team member personal names appearing only in template fixtures | current handle in CODEOWNERS (product-facing) | manual review (no automatic gate today) |
| **B.1** | Internal project names | maintainer's other private repo names (codename-shaped and specific) | public product names, or project-owned names deliberately added to the workflow allowlist | SB-N-02 (categorical regex in `commit-message-scan.yml`) + `.ship-boundary-deny.local` (project-specific exact-match extension) |
| **B.2** | Credentials | API keys, OAuth tokens, SSH private keys, session cookies | `.env.example` with placeholder values | `gitleaks.yml` + `detect-secrets` + `commit-message-scan.yml` |
| **B.3** | Personal filesystem paths | `/Users/<name>/`, `/home/<name>/`, hardcoded home paths in scripts | `$HOME`, `$(cd "$(dirname "$0")"; pwd)`, repo-relative paths | SB-N-03 regex + `hygiene.yml` |
| **B.4** | Business judgement | real customer names in tests, competitor assessments in commit bodies, strategic-direction commentary | generic product category references ("CI templates", "PR gates") | manual review (no pattern-based gate exists) |
| **C.1** | Tracked file content | everything in `src/`, `scripts/`, `.github/`, `docs/`, root-level docs | `.env.example`, example fixtures with synthetic values | `hygiene.yml` + `semgrep.yml` + `trivy.yml` + `gitleaks.yml` |
| **C.2** | Commit messages (subject + body) | `feat: absorb genes from <internal-project>`, `fix paths after migrating off /Volumes/4TB/` | `feat: improve setup`, plain English describing behavior | `commit-message-scan.yml` workflow |
| **C.3** | Scrub phrasing | `removed X reference`, `previously private Y paths`, `dropped the Z mention` in CHANGELOG or commit messages | current-state phrasing: "now points at the public repo", "check renamed for clarity" | SB-N-05 pattern in `commit-message-scan.yml` + manual review |
| **C.4** | Timing patterns | commit timezone revealing personal geo, commit cadence revealing working hours | — (not enforced; would require git history rewrite with bogus timestamps, high cost) | explicit non-goal |

## Canonical mapping - commit-message scan rules tagged by dimension

The shipped `commit-message-scan.yml` workflow uses the SB-N labels below for deterministic commit-message enforcement. File-content enforcement mirrors the same intent through `hygiene.yml`, gitleaks, semgrep, and manual review.

| Rule | Category |
|---|---|
| SB-N-01 secrets_env | B.2 |
| SB-N-02 codename_shaped_tokens | B.1 |
| SB-N-03 personal_filesystem_paths | B.3 |
| SB-N-04 api_keys_inline | B.2 |
| SB-N-05 scrub_phrasing_changelog | C.3 |
| SB-N-06 machine_derived_hostnames | A.2 |

## Boundary line — public product names vs. private instances

A common ambiguity: "I want to reference a third-party service. Is mentioning it a leak?"

Rule:
- **Public product name, generic reference → OK**: mentioning "e2b.dev" or "Tailscale" or "Claude Code" as category descriptors is fine.
- **Private instance identifier → NOT OK**: your actual tailnet hostname, your specific e2b sandbox ID, your org name in a service URL are leaks.

Example:
- ✅ "Install the e2b CLI to use sandboxes." — product name, generic use
- ❌ "Our e2b sandboxes are at `foo-bar.e2b.app`" — specific instance

## Working with `.ship-boundary-deny.local`

For dimensions B.1 (internal project names) and A.3 (account/team names), the canonical contract stays **categorical** (e.g. SB-N-02's codename-shape regex). Specific strings stay in each repo's local deny-file:

1. Create `.ship-boundary-deny.local` at the repo root — already `.gitignored` via the baseline.
2. One literal string or regex per line (lines beginning `#` are comments).
3. CI workflows that scan for private information (`hygiene.yml`, `commit-message-scan.yml`) read this file opportunistically — if present, its entries extend the NEVER tier at scan time; if absent, they skip.

IMPORTANT: `.ship-boundary-deny.local` itself must never end up in a tracked file — different contributors have different exposure surfaces, the deny list is a per-identity concern.

## When the taxonomy gets revised

- **A new dimension of leak** (not covered by A/B/C) -> update this doc and the workflows or hooks that enforce it.
- **A new subcategory** within A/B/C -> add a row here and add a matching SB-N-XX check where mechanical enforcement is practical.
- **A rule's category needs reclassification** -> update this table and the relevant workflow messages in one change.

## Related

- Commit-message enforcement: `templates/universal/commit-message-scan.yml`
- File-provenance tier rules: `templates/configs/ship-boundary.md`
- History rewrite playbook (for when a leak already reached `origin`): `docs/history-rewrite-runbook.md`
- Public-repo identity rules: `~/.claude/standards/public-repo.md` (for this maintainer's own harness)
