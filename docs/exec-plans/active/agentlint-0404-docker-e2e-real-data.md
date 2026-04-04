# AgentLint Docker E2E — Real Corpus Data

## Goal

用真实的 CLAUDE.md corpus 数据，在干净的 Docker 环境里跑完整 pipeline，验证产品在 Linux + 首次安装场景下能正常工作。同时修掉剩余的已知问题（F5 E2E、plugin 配置），让产品可以发布。

## Background

上一轮（agentlint-0404-real-world-validation）验证了核心引擎：scanner 准确、fixer 安全、分数有意义。但有 4 个洞没补：

1. **全流程未在真实 session 跑过** — 每个零件验过，胶水层没测
2. **F5 E2E 有 2 个 pre-existing failure** — gamma fixture 的 F5 auto-fix 跑不过
3. **Install script 未在干净机器测过** — `curl | bash` 路径没验证
4. **enabledPlugins 还指向旧名 agent-lint** — 配置没更新

Docker + 真实 corpus 一次解决 #1 和 #3。#2 和 #4 独立修。

## Data Source

```
~/corpus/repos/    4533 repos
├── {owner}__{repo}/
│   ├── _meta.json          # stars, lang, description, created_at
│   ├── CLAUDE.md            # 真实内容（42/50 top repos 有）
│   ├── AGENTS.md            # 27/50 有
│   ├── root-tree.txt        # 完整文件树（dir/file + name + size）
│   ├── workflows/           # 真实 GitHub Actions YAML
│   ├── package.json         # 真实内容（31/50 有）
│   ├── settings.json        # Claude Code settings
│   ├── rules/               # 规则文件
│   └── _other/              # 其他配置文件
```

每个 repo 的数据足够重建 scanner 需要的所有信号：文件存在性、CLAUDE.md 内容、workflow YAML、linter 配置、目录结构。

## Features

### F001: 从 corpus 重建真实 repo — todo

目的：把 corpus 的结构化数据还原成 scanner 能扫的 git repo。不是假项目 — 是 4533 个真实项目的真实 CLAUDE.md 和 CI 配置。

#### Steps

- [ ] S1: 写 `tests/docker-e2e/select-repos.js` — 从 corpus 选 15 个 repo ← verify: 输出 `tests/docker-e2e/selected-repos.json`，覆盖 3 tier
  - 选择标准：
    - Tier A（5 个）：stars > 10K，有 CLAUDE.md，有 workflows，有 package.json 或 pyproject.toml
    - Tier B（5 个）：stars 1K-10K，有 CLAUDE.md 或 AGENTS.md，部分基础设施
    - Tier C（5 个）：stars < 1K 或无 CLAUDE.md，最少基础设施
  - 每个 repo 记录：name, path, tier, stars, lang, 有哪些 corpus 文件
- [ ] S2: 写 `tests/docker-e2e/reconstruct-repo.sh` — 从 corpus 数据重建单个 git repo ← verify: 对一个 corpus repo 跑，产出的目录能通过 `bash src/scanner.sh --project-dir`
  - 重建逻辑：
    1. 读 `root-tree.txt`，`mkdir -p` 所有 `dir` 行
    2. 所有 `file` 行创建空文件（`touch`）
    3. 复制 `CLAUDE.md`（真实内容）
    4. 复制 `AGENTS.md`（如果有）
    5. 复制 `workflows/*.yml` → `.github/workflows/`
    6. 复制 `package.json`、`pyproject.toml`、linter 配置（如果有）
    7. 如果有 `.gitignore` 在 root-tree.txt 里，创建最小 `.gitignore`（含 `.env`）
    8. `git init && git add -A && git commit -m "init"`
  - 不复制的：`_meta.json`、`*.history.json`、`_other/`（这些是 corpus 元数据，不属于原始 repo）
- [ ] S3: 写 `tests/docker-e2e/package-corpus.sh` — 把 15 个 repo 的 corpus 数据打包成 `tests/docker-e2e/corpus-data.tar.gz`（depends: S1）← verify: tar 文件 < 5MB，包含 15 个 repo 的所有需要的文件

### F002: Docker 全流程测试 — todo

目的：在干净 Linux 容器里，从 0 开始跑完整 pipeline。证明产品在非 macOS 环境下能工作。

#### Steps

- [ ] S1: 写 `tests/docker-e2e/Dockerfile` ← verify: `docker build` 成功
  - 基于 `node:20-slim`
  - 安装 `bash jq git`
  - COPY AgentLint 源码
  - COPY `corpus-data.tar.gz` 并解压
  - 用 `reconstruct-repo.sh` 重建 15 个 repo
- [ ] S2: 写 `tests/docker-e2e/run-tests.sh` — 容器内跑的测试脚本（depends: F001.S2）← verify: 在 Docker 里跑通
  - 测试项：
    1. **Prerequisites**: jq, node, git 可用
    2. **Scanner per-repo**: 15 个 repo 各跑一次 scanner，全部产出 valid JSONL，0 crash
    3. **Scorer**: 每个 scanner 输出喂给 scorer，产出 valid JSON with `total_score`
    4. **Tier 验证**: Tier A 平均分 > Tier B > Tier C（和 F004 calibration 对齐）
    5. **Plan generator**: scorer 输出喂给 plan-generator，`total_items >= 1`
    6. **Fixer**: 对 Tier C 的一个 repo 跑 fixer（F1 创建 CLAUDE.md），验证文件创建
    7. **Fixer 安全**: fixer 后 `git diff` 只改了 markdown 文件
    8. **Re-scan**: fix 后重新 scan + score，分数应该提升
    9. **Reporter**: 4 种格式（terminal, md, jsonl, html）都能生成
    10. **Error handling**: 不存在的目录 → 非零退出码；空输入 → 0 分
- [ ] S3: 写 `tests/docker-e2e/run.sh` — 一键构建 + 运行 ← verify: `bash tests/docker-e2e/run.sh` 从 0 到绿灯
  - `docker build -t agentlint-e2e -f tests/docker-e2e/Dockerfile .`
  - `docker run --rm agentlint-e2e`
  - 退出码 0 = 全绿，非 0 = 有 failure

### F003: 修 F5 E2E 失败 — todo

目的：gamma fixture 的 F5 auto-fix 测试跑不过。这是 pre-existing bug — F5 从 auto 改成 assisted 后测试没跟上。

#### Steps

- [ ] S1: 读 `tests/test-e2e.sh` 里 gamma 相关的 F5 测试，理解期望行为（depends: nothing）← verify: 写出根因 — 是测试期望 auto 但代码改成了 assisted，还是其他原因
- [ ] S2: 修复测试或代码（depends: S1）← verify: `bash tests/test-e2e.sh` 全部 45/45 pass
- [ ] S3: 重跑 Docker E2E 确认不影响（depends: F002.S3, S2）← verify: Docker E2E 全绿

### F004: Plugin 配置更新 — todo

目的：`~/.claude/settings.json` 的 `enabledPlugins` 还指向旧名 `agent-lint`，需要改成 `agent-lint`。

#### Steps

- [ ] S1: 读 `~/.claude/settings.json`，找到 `enabledPlugins` 里的 `agent-lint` 条目 ← verify: 确认旧名存在
- [ ] S2: 更新为 `agent-lint`（depends: S1）← verify: `grep agent-lint ~/.claude/settings.json` 有匹配
- [ ] S3: 验证 `/al` 命令在 skill list 里正常加载（depends: S2）← verify: skill list 包含 `al`（这一步需要新 session 或 reload）

## Execution Order

```
F001 (重建 repo)  →  F002 (Docker E2E)  →  F003 (F5 fix)  →  F004 (config)
                                               ↑
                                          可以和 F002 并行
```

F001 和 F002 是主线。F003 独立可并行。F004 最后（不在 Docker 里，在本地做）。

## Success Criteria

1. **F002**: Docker 里 15 个真实 repo 全流程通过，Tier A > B > C，fixer 安全，reporter 4 格式正常
2. **F003**: E2E 45/45 全绿
3. **F004**: `/al` 从新名正常加载
4. **总结**: 能说 "产品在 Linux 干净环境 + 真实数据上验证通过，可以发布"

## Constraints

- Corpus 数据打包后 < 5MB（只选 15 个 repo 的关键文件，不含 history.json 和 _other）
- Docker 测试不碰本地环境 — 所有操作在容器内
- 打包的 corpus 数据不含内部项目名（遵守 gitleaks 规则）
- `corpus-data.tar.gz` 加入 `.gitignore`（不提交到 git — 太大且含外部 repo 数据）

## Decision Log

- 2026-04-04: 用真实 corpus 数据替代假项目。原因：假项目只能测 "代码逻辑对不对"，真实 CLAUDE.md 能测 "scanner 在真实内容上会不会出意外"。
- 2026-04-04: 选 15 个 repo 而非全 corpus。原因：Docker build 要快（< 2min），15 个够覆盖 3 tier × 5 diversity。
- 2026-04-04: corpus-data.tar.gz 不提交到 git。原因：含第三方 repo 的文件内容，许可证不确定。本地生成，Docker 构建时 COPY 进去。
