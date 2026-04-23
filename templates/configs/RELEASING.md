# Releasing __PROJECT_NAME__

Two release flavors. Pick whichever matches this project — **delete the other section**.

---

## Flavor A · App / service (default for `private: true` packages)

For web apps, CLIs used via `npx`, deployed services, and anything that ships through CI/CD rather than `npm publish`.

1. Merge selected PRs to main
2. Update `CHANGELOG.md`: move items from `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD`
3. Tag: `git tag vX.Y.Z && git push --tags`
4. CI (`release.yml`) creates a GitHub Release with the changelog body attached

Tag push triggers the release. No tag = no release. No npm involvement.

### Prerequisites

- Nothing repo-side — the default workflow only needs `GITHUB_TOKEN`, which GitHub provides automatically.

---

## Flavor B · npm package (delete this section if not publishing to npm)

For libraries published to npm.

1. Merge selected PRs to main
2. Bump version in `package.json` and commit it on main
3. Update `CHANGELOG.md`
4. Tag: `git tag vX.Y.Z && git push --tags`
5. CI (`release.yml`) runs tests + `npm publish --provenance`

### Prerequisites

- `NPM_TOKEN` secret in GitHub repo settings (granular, scoped to this package, bypass 2FA)
- `package.json` has `"private": false` (or no `private` field)

### Rollback

- **Before tag**: nothing published, just fix on main
- **After publish**: ship a new patch version (forward-fix)
- **Emergency**: `npm unpublish project-name@X.Y.Z` within 72h — last resort, breaks any consumer that depended on that exact version

---

## Version scheme (both flavors)

- `patch` (0.1.7 → 0.1.8): bug fixes, internal refactors
- `minor` (0.1.8 → 0.2.0): new features, backwards-compatible
- `major` (0.2.0 → 1.0.0): breaking changes — document in CHANGELOG migration notes
