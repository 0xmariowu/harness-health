# Deep Analyzer Test Fixtures

Five small fixtures exercised by `tests/test-deep-analyzer.sh`:

| Fixture | Size | Purpose |
|---------|------|---------|
| `small/CLAUDE.md` | < 1 KB | Minimum-viable entry; triggers small-file prompt branch |
| `medium/CLAUDE.md` | 1-5 KB | Typical mid-size entry file |
| `large/CLAUDE.md` | ≥ 10 KB | Triggers large-file prompt branch |
| `contradiction/CLAUDE.md` | any | Contains deliberately contradictory / dead-weight / vague rules; useful when a test does exercise a real AI sub-agent |
| `no-entry/` | empty | Project dir with no CLAUDE.md / AGENTS.md; should produce zero tasks |

The fixture corpus is the **default** for `test-deep-analyzer.sh`. If you
want to test against a real large-scale corpus, set `AL_CORPUS_DIR=/path/to/corpus`
and the test will use that instead.

Fixtures are intentionally minimal and contain no personal data. They
exist so every contributor can run `bash tests/test-deep-analyzer.sh`
on a clean checkout without private inputs.
