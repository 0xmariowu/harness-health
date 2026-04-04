# AgentLint 隐私清理 — 公开发布前净化

## Goal

清除 repo 中所有个人隐私和内部数据泄露。这个 repo 要公开，任何个人信息、私人目录结构、内部项目名、机器名都不能出现 — 包括 git 历史里已删除的文件。

## Background

隐私审计发现 15 处问题。之前已做过几轮清理（commit `ec7b556`、`189415e`、`6acb845` 等），清掉了 Armory/AIMD/kalami 等内部项目名，但还有残留。最严重的两个：`.gitleaks.toml` 本身泄露了真实机器名，git 历史里还存着一个完整的内部开发日记。

**和安全加固计划的关系**：`agentlint-0404-security-and-practices-hardening.md` 处理代码安全漏洞和规范问题。这个计划处理隐私泄露。重叠部分（`~/Projects` 硬编码、`harness-health` 引用）在这个计划里处理。

## Features

### F001: [P0] 清除 .gitleaks.toml 中的真实机器名 — todo

**为什么必须修**：防泄露的配置文件本身泄露了真实 Tailscale 节点名和机器 hostname。任何人打开这个文件就知道开发者的机器名和网络拓扑。

#### Steps
- [ ] S1: 修改 `.gitleaks.toml` tailscale-domain 规则 — 删掉具体 hostname，改成通用 pattern ← verify: `grep -cE 'tailcca|vimalamac' .gitleaks.toml` 返回 `0`

**改法**：`.gitleaks.toml:17-23`，tailscale-domain 规则改为：
```toml
[[rules]]
id = "tailscale-domain"
description = "Tailscale network address or internal hostname leaked"
regex = '''[a-z0-9\-]+\.ts\.net'''
tags = ["pii", "hostname"]
keywords = [".ts.net"]
```
只保留通用的 `.ts.net` pattern，不列具体机器名。

---

### F002: [P0] 清除 git 历史中的敏感文件 — todo

**为什么必须修**：commit `dc6ba8f7` 添加了 `experience/` 目录，后来被删除。但 `git show` 仍然可以完整恢复。内容包含旧产品名、内部 GitHub URL、开发日记、架构决策过程。

**⚠️ 不可逆操作 — force push 后所有已有 clone/fork 会断裂。**

#### Steps
- [ ] S1: 用 `git-filter-repo` 清除 `experience/` 目录 + 统一 author name ← verify: `git log --all --diff-filter=A --name-only -- experience/` 返回空；`git log --all --format='%an' | sort -u` 只返回 `0xmariowu`

**命令**（一次 filter-repo 调用同时完成两件事）：
```bash
pip3 install git-filter-repo
cp -r . ../agent-lint-backup

# mailmap: 统一 author name
cat > /tmp/al-mailmap << 'EOF'
0xmariowu <130952152+0xmariowu@users.noreply.github.com> Mario <130952152+0xmariowu@users.noreply.github.com>
EOF

git filter-repo --path experience/ --invert-paths --mailmap /tmp/al-mailmap --force
```

**注意**：`filter-repo` 执行后会删除 remote tracking refs（这是 filter-repo 的设计行为，防止意外 push 覆盖未重写的远程历史）。需要在 S3 重新添加 remote。

- [ ] S2: commit message 清理评估（depends: S1）← verify: 运行 `git log --all --format='%s' | grep -iE '/hh[^a-z]|harness.health'` 并记录结果

**说明**：
- `corpus` 是通用英文词（语料库），不泄露私人信息，不需要清理
- `/hh` 和 `harness-health` 如果出现在 commit message 里，需要决定是否值得再跑一次 filter-repo（`--message-callback`）
- 这是一个**人工确认点** — agent 记录结果，用户决定是否需要额外清理

- [ ] S3: 重新添加 remote + force push（depends: S1+S2 + 用户确认）← verify: `git remote -v` 显示 origin；`git push --force origin main` 成功

**命令**：
```bash
git remote add origin git@github.com:0xmariowu/agent-lint.git
git push --force origin main
# 如果有其他分支也需要 push：
git push --force origin --all
git push --force origin --tags
```

注意：用 `--force` 而不是 `--force-with-lease`，因为 filter-repo 删除了 remote tracking refs，`--force-with-lease` 没有 lease ref 可以比较，会失败。

---

### F003: [P1] 删除旧 exec plans — todo

**为什么必须修**：`docs/exec-plans/active/` 里 3 个旧计划含大量私人信息（私人 corpus 路径和规模、本地项目数量、私人配置路径、旧产品名）。

涉及文件：
- `agentlint-0404-docker-e2e-real-data.md`
- `agentlint-0404-real-world-validation.md`
- `agentlint-0404-expanded-testing.md`

这些计划的工作已全部 merge 完成，对公开用户没有价值。

#### Steps
- [ ] S1: 直接删除 3 个旧计划 ← verify: `ls docs/exec-plans/active/` 只包含 `agentlint-0404-security-and-practices-hardening.md` 和 `agentlint-0404-privacy-sanitization.md`

**命令**：
```bash
git rm docs/exec-plans/active/agentlint-0404-docker-e2e-real-data.md
git rm docs/exec-plans/active/agentlint-0404-expanded-testing.md
git rm docs/exec-plans/active/agentlint-0404-real-world-validation.md
```

---

### F004: [P1] 清理 HANDOFF.md — todo

**为什么必须修**：`HANDOFF.md:9` 写着 `Update ~/.claude/settings.json enabledPlugins from harness-health to agent-lint`，泄露私人配置路径 + 旧产品名。

#### Steps
- [ ] S1: 重写 HANDOFF.md 的 Next 部分 ← verify: `grep -E 'harness.health|~/.claude/settings' HANDOFF.md` 返回空

**改法**：`HANDOFF.md:9`，改为 `2. Update local plugin config to use agent-lint`

---

### F005: [P2] 修 reference-thresholds.json 旧缩写 — todo

**为什么必须修**：`standards/reference-thresholds.json:2` 的注释用了 `HH`（Harness Health 缩写）。

#### Steps
- [ ] S1: `HH` → `AgentLint` ← verify: `grep 'HH ' standards/reference-thresholds.json` 返回空

**改法**：`standards/reference-thresholds.json:2`
`"HH measures and compares"` → `"AgentLint measures and compares"`

---

### F006: [P2] 修 validation-report.tsx 旧产品名 — todo

#### Steps
- [ ] S1: 修改 bug 描述，不引用旧产品名 ← verify: `grep 'harness-health' tests/validation-report.tsx` 返回空

**改法**：`tests/validation-report.tsx:80`
`"Rename from harness-health to agent-lint missed the install script"` → `"Product rename missed the install script"`

---

### F007: [P2] 修测试文件的 corpus fallback 路径 — todo

**为什么必须修**：10 个测试文件（8 个 shell + 2 个 JavaScript）用 `${HOME}/corpus/` 作为 fallback，泄露私人 corpus 目录结构。

**Shell 脚本**（8 个）：
1. `tests/fixer-safety/run-fixer-safety.sh:13`
2. `tests/robustness/run-scanner-robustness.sh:11`
3. `tests/calibration/run-calibration.sh:10`
4. `tests/accuracy/run-accuracy.sh:9`
5. `tests/accuracy/auto-label.sh:9`
6. `tests/test-deep-analyzer.sh:7`
7. `tests/docker-e2e/package-corpus.sh:8`
8. `tests/docker-e2e/package-full-corpus.sh:9`

**JavaScript 文件**（2 个）：
9. `tests/docker-e2e/select-repos.js:12`
10. `tests/accuracy/auto-label.js:12`

#### Steps
- [ ] S1: 所有 10 个文件的 fallback 路径改为要求显式设置 `AL_CORPUS_DIR` ← verify: `grep -rn 'HOME.*corpus' tests/` 返回空

**Shell 改法**：每个文件从：
```bash
CORPUS_DIR="${AL_CORPUS_DIR:-${HOME}/corpus/sources}"
```
改为：
```bash
CORPUS_DIR="${AL_CORPUS_DIR:?ERROR: Set AL_CORPUS_DIR to your corpus directory}"
```

**JavaScript 改法**：每个文件从：
```javascript
const CORPUS = process.env.AL_CORPUS_DIR || path.join(process.env.HOME, 'corpus', 'repos');
```
改为：
```javascript
if (!process.env.AL_CORPUS_DIR) { process.stderr.write('ERROR: Set AL_CORPUS_DIR to your corpus directory\n'); process.exit(1); }
const CORPUS = process.env.AL_CORPUS_DIR;
```

注意：`tests/docker-e2e/package-corpus.sh:8` 有双重嵌套 `${AL_CORPUS_DIR:-${AL_CORPUS_DIR:-${HOME}/corpus/repos}}`（copy-paste bug），一起修掉。

---

### F008: [P2] 修 commands/al.md 中的硬编码路径 — partial (PR #35 已修 line 123, 173)

**为什么必须修**：`commands/al.md` 有 5 处 `~/Projects`，其中 line 123、173、221 是示例命令（AI 会照搬）。

**PR #35 已修**：line 123 → `$PROJECT_DIR`，line 173 → `<your-project-dir>`

#### Steps
- [ ] S1: 修 line 221 ← verify: `grep -n '~/Projects' commands/al.md` 只在 line 36 和 39 出现

**改法**：
- Line 36 `[~/Projects]: ↵` — **保留**
- Line 39 `Press Enter → uses ~/Projects` — **保留**
- ~~Line 123~~ — done in PR #35
- ~~Line 173~~ — done in PR #35
- Line 221 `~/Projects, Enter to accept` → `default dir, Enter to accept`

---

### F009: [P2] CHANGELOG.md 旧产品名 — 保留不动 — todo

CHANGELOG 在 v0.1.x 条目中引用 `/hh` 和 `skills/hh/SKILL.md`。这些是历史变更记录，引用旧路径是合理的 — CHANGELOG 本来就是记录"改了什么"，删除反而不完整。

#### Steps
- [ ] S1: 确认保留，不做修改 ← verify: Decision Log 记录决策

---

### F010: 清理计划文件自身 — todo

**为什么必须修**：这个隐私计划和安全加固计划的文本里都引用了私人信息（作为"要修什么"的说明）。执行完成后这两个文件会让最终 grep 验证失败。

#### Steps
- [ ] S1: 所有 Feature 执行完成后，删除这个隐私计划文件 + 安全加固计划文件（它们的价值在执行阶段，完成后不需要留在公开 repo）← verify: `ls docs/exec-plans/active/` 返回空或只剩不含敏感信息的文件

**时机**：最后执行，在所有其他 Feature 都完成并验证后。

---

## 执行顺序

```
第一步：工作树内修复（PR 流程，fix/privacy-sanitization 分支）
  F001 (.gitleaks.toml) ─┐
  F003 (删旧 exec plans) ─┤
  F004 (HANDOFF.md)       ─┤ 全部可并行，互不依赖
  F005 (thresholds.json)  ─┤
  F006 (validation.tsx)   ─┤
  F007 (corpus 路径 x10)  ─┤
  F008 (al.md 路径)       ─┤
  F009 (CHANGELOG 确认)   ─┘

  ↓ merge PR 到 main

  F010 (删除计划文件自身) ← 单独 commit 到 main 或新 PR

第二步：git 历史清理（不可逆，用户确认后执行）
  F002 S1 (filter-repo) → S2 (评估 commit msg) → S3 (force push)

第三步：最终验证
  grep -rn 'tailcca451\|vimalamac' . --exclude-dir=.git
  grep -rn 'harness.health' . --exclude-dir=.git | grep -v CHANGELOG
  grep -rn 'HOME.*corpus\|~/corpus' . --exclude-dir=.git
  git log --all --format='%an' | sort -u
  gitleaks detect --source . --config .gitleaks.toml
```

**为什么分两步**：第一步是普通 commit 操作，走正常 PR 流程。第二步的 `git filter-repo` 重写所有 commit hash。先做文件修复 merge 到 main，再做历史清理，这样第一步的 PR 流程完全正常。

## Constraints

- F001-F010（除 F002）走 PR，开 `fix/privacy-sanitization` 分支
- F002 必须在 main 上跑（重写所有分支），不能走 PR 流程
- F002 执行前必须满足：(1) 所有其他 PR 已 merge，(2) 本地备份已创建，(3) 用户明确确认
- F002 执行后 `--force-with-lease` 不可用（filter-repo 删除 remote tracking refs），必须用 `--force`
- 每个 Feature 完成后跑 `gitleaks detect --source . --config .gitleaks.toml` 验证无新泄露

## Decision Log

- 2026-04-04: `.gitleaks.toml` 不应包含真实 hostname — 通用 `.ts.net` pattern 足够防护。
- 2026-04-04: 旧 exec plans 直接 `git rm` — 公开用户不需要看内部开发计划，编辑后信息量太少没保留价值。
- 2026-04-04: `~/Projects` 在 `commands/al.md:36,39` 保留 — 用户引导 prompt 的默认值，`~/Projects` 是通用 Unix 约定。
- 2026-04-04: CHANGELOG 旧路径名保留 — 历史变更记录引用旧文件路径是正常的。
- 2026-04-04: Git author name 统一为 `0xmariowu` — 和 filter-repo 一起做，成本为零。
- 2026-04-04: Commit message 里的 `corpus` 不清理 — 通用英文词，不泄露具体信息。`harness-health` 需要评估（F002 S2）。
- 2026-04-04: filter-repo 后用 `--force` 而非 `--force-with-lease` — filter-repo 删除 remote tracking refs 是设计行为，lease ref 不存在会导致 push 失败。
- 2026-04-04: 审稿修复 — F007 从 8 个文件扩展到 10 个（加了 `select-repos.js` 和 `auto-label.js` 两个 JS 文件）；F002 加了 remote 重建步骤（filter-repo 删除 remote）；加了 F010 处理计划文件自身的敏感引用。

## Open Questions

- **filter-repo 后的 commit message 是否需要清理？** F002 S2 评估后决定。如果有 `harness-health`，用 `--message-callback 're.sub(b"harness-health", b"agent-lint", message)'` 清理。
