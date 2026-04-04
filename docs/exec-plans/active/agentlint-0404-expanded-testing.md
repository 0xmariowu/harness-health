# AgentLint Expanded Testing — Volume + Blind Spots

## Goal

把测试量从 169 repos 扩到 4533 repos（全 corpus），同时补上 5 个完全没覆盖的盲区。完成后，产品的每个用户可触达的路径都有测试证据。

## Background

上两轮测试验证了核心引擎（scanner/scorer/fixer/reporter）和 Docker 全流程。发现并修了 5 个 bug。但有两类问题没解决：

1. **量不够**：169 repos 的鲁棒性 ≠ 4533 repos。20 repos 的准确性数据点太少，看不到长尾分布。
2. **盲区**：install script、HTML report 内容、deep analyzer、session analyzer、/al 命令编排 — 全是零测试。

## Features

### F001: 全 corpus 鲁棒性 + 分数分布 — todo

目的：在 Docker 里跑 scanner + scorer 对全部 4533 repos。验证 0 crash 且分数分布合理。

这是最高 ROI 的测试 — 用现有工具 + 现有数据，一行命令覆盖 26 倍的测试量。

#### Steps

- [ ] S1: 写 `tests/docker-e2e/package-full-corpus.sh` — 打包全 4533 repos 的 corpus 数据（只打包 scanner 需要的文件：CLAUDE.md, AGENTS.md, root-tree.txt, workflows/, package.json, linter configs）← verify: tar.gz 文件存在，大小 < 50MB
- [ ] S2: 写 `tests/docker-e2e/Dockerfile.full-corpus` — 基于 node:20-slim，重建全部 repos，跑 scanner + scorer ← verify: docker build 成功
- [ ] S3: 写 `tests/docker-e2e/run-full-corpus.sh` — 容器内跑的脚本 ← verify: 输出 JSON 汇总
  - 对每个 repo 跑 scanner + scorer
  - 收集：repo name, exit_code, jsonl_valid, total_score, runtime_ms
  - 汇总统计：
    - crash count（exit code != 0 且 != 正常错误）
    - hang count（timeout 60s）
    - 分数分布（min, p25, median, p75, max, mean）
    - 各 tier 分数分布（按有/无 CLAUDE.md 分组）
    - 跑完总耗时
  - 输出 `results.json` + 终端 summary
- [ ] S4: 跑全量测试（depends: S1-S3）← verify:
  - 0 crash, 0 hang
  - 有 CLAUDE.md 的 repos 平均分 > 无 CLAUDE.md 的平均分（gap > 15）
  - 分数分布不退化（不是 90% 集中在一个分数段）
  - 跑完时间 < 30 分钟
- [ ] S5: 如果发现 crash/hang → 修复 scanner，重跑（depends: S4）← verify: 重跑 0 crash

### F002: Install script Docker 测试 — todo

目的：用户安装的第一步。`curl | bash` → plugin 注册 → `/al` 命令可用。如果这步失败，后面全白搭。

#### Steps

- [ ] S1: 写 `tests/docker-e2e/Dockerfile.install` — 从 0 模拟用户安装 ← verify: docker build 成功
  - 基于 `node:20-slim`（不预装 AgentLint）
  - 安装 `bash jq git curl`
  - 模拟用户目录结构：`~/.claude/` + 一个假项目
  - 跑 install script：`bash scripts/install.sh`（不用 curl — 本地 COPY 后执行）
  - 验证：
    1. plugin 目录被创建到正确位置
    2. `.claude-plugin/plugin.json` 存在且 valid JSON
    3. `commands/al.md` 存在
    4. scanner.sh 可执行
    5. 跑 scanner 对假项目能产出 JSONL
- [ ] S2: 读 `scripts/install.sh` 源码，确认它不依赖 macOS 特有命令（depends: nothing）← verify: 列出所有用到的命令，确认 Linux 有等价物
- [ ] S3: 跑 Docker install 测试（depends: S1）← verify: 全部验证项 pass

### F003: HTML report 内容验证 — todo

目的：HTML report 是用户看到的主要产出物。测了"能生成"但没测"内容对不对"。gauge 显示的分数可能和 scorer 不一致、check 数量可能不对、维度名可能拼错。

#### Steps

- [ ] S1: 写 `tests/test-html-report.js` — 解析 HTML report，验证内容一致性 ← verify: 测试 pass
  - 用 node 读 HTML 字符串（不需要浏览器，纯文本解析）
  - 验证项：
    1. 总分和 scorer 输出的 `total_score` 一致
    2. 5 个维度名全部出现（findability, instructions, workability, continuity, safety）
    3. 每个维度分数和 scorer 输出一致
    4. check count = 31（或者等于 scorer 输出的 check 数）
    5. SVG gauge 存在（`<svg` 标签）
    6. 无 broken HTML 标签（所有 `<div>` 有对应 `</div>`）
    7. 无空的分数值（不出现 `NaN`、`undefined`、`null` 在可见文本里）
- [ ] S2: 对 3 个不同分数段的 repo（高/中/低）生成 HTML report 并验证（depends: S1）← verify: 3 个 report 全部通过 7 项检查

### F004: Deep analyzer 真实 repo 测试 — todo

目的：deep-analyzer.js 生成 AI subagent prompts（D1 矛盾规则、D2 无效规则、D3 模糊规则）。从没在真实 CLAUDE.md 上跑过。不需要真的跑 AI — 只验证 prompt 生成不崩溃、格式正确。

#### Steps

- [ ] S1: 读 `src/deep-analyzer.js`，理解输入/输出格式 ← verify: 记录 CLI 接口和输出 schema
- [ ] S2: 写 `tests/test-deep-analyzer.sh` — 对 3 个真实 repo 的 CLAUDE.md 跑 deep-analyzer ← verify: 测试 pass
  - 验证项：
    1. 退出码 0
    2. 输出是 valid JSON
    3. 包含 D1、D2、D3 三个 task
    4. 每个 task 有 `prompt` 字段（非空字符串）
    5. prompt 包含实际的 CLAUDE.md 内容片段（不是空模板）
  - 测试数据：从 corpus 选 3 个不同大小的 CLAUDE.md（< 1KB, 1-5KB, > 10KB）

### F005: Session analyzer 基础验证 — todo

目的：session-analyzer.js 从没跑过。至少验证它能启动、能处理空目录、不崩溃。不测分析质量（需要真实 session log），只测代码健壮性。

#### Steps

- [ ] S1: 读 `src/session-analyzer.js`，理解 CLI 接口 ← verify: 记录参数和输出格式
- [ ] S2: 写 `tests/test-session-analyzer.sh` ← verify: 测试 pass
  - 验证项：
    1. `--help` 退出码 0
    2. 空目录 → 退出码 0，输出 valid JSON（空结果）
    3. 不存在的目录 → 退出码非 0 或 valid JSON with empty results（不崩溃）
    4. 造一个 fake session log JSONL（3 条 user message），验证能被解析

### F006: 测试验证报告 — 用 agentlint-report.tsx 风格 — todo

目的：把所有测试结果做成一个可视化报告，和产品本身的 HTML report 同样的设计语言。发布时可以展示给用户看 — "这是我们验证过的证据"。

参考设计：`agentlint-report.tsx`（React 组件，gauge + dimension bars + check items + fix list）

#### Steps

- [ ] S1: 写 `tests/validation-report.tsx` — React 组件，复用 agentlint-report.tsx 的视觉系统 ← verify: 能在 claude.ai artifacts 里渲染
  - 数据结构改为测试结果（不是 repo scan 结果）：
    - **Gauge**: 总测试通过率（当前值 vs 目标值）
    - **Dimensions** 改为 6 个测试类别：
      1. Robustness（169+ repos, 0 crash）
      2. Accuracy（20 repos × 31 checks, 96.6%）
      3. Fixer Safety（69 repos, 0 RED FLAG）
      4. Score Calibration（15 repos, A>B>C）
      5. Docker E2E（15 real repos, 16/16 pass）
      6. Unit + E2E（69/69 pass）
    - 每个类别展开显示具体 check items（pass/fail/fixed）
    - **Bugs Found** section（替代 Remaining Fixes）：列出 5 个发现并修复的 bug
    - **Evidence footer**: 测试数据来源 + 日期
  - 视觉复用：
    - Gauge（segmented arc）: 总 pass rate
    - DimRow（progress bar + count pills）: 每个测试类别
    - CheckItem（dot + expand detail）: 每个具体测试
    - Color scheme: pass=#1D9E75, warn=#EF9F27, fail=#E24B4A
    - 新增 `fixed` pill 用于展示修复的 bug
- [ ] S2: 填入真实测试数据（depends: F001-F005 完成后）← verify: 所有数字和实际测试结果一致
- [ ] S3: 加入 corpus 全量测试的分数分布图（depends: F001）← verify: 分布数据来自 F001 的 results.json

## Execution Order

```
F001 (全 corpus)     独立跑，耗时最长（Docker build + 4533 repos）
  ↓
F002 (install)       独立，和 F001 并行
  ↓
F003 (HTML report)   独立，和 F001/F002 并行
  ↓
F004 (deep analyzer) 独立，可并行
  ↓
F005 (session)       独立，可并行
```

F001 是 long-running（可能 10-20 分钟），F002-F005 都是 5 分钟内的小活。F006 等 F001-F005 数据出来后做。全部可以并行开发，串行执行。

## Success Criteria

1. **F001**: 4533 repos 0 crash/0 hang，有 CLAUDE.md 的 repos 平均分比无 CLAUDE.md 高 15+
2. **F002**: Docker 里从 install.sh 到 scanner 跑通
3. **F003**: 3 个 HTML report 通过 7 项内容检查
4. **F004**: 3 个真实 CLAUDE.md 生成的 D1-D3 prompts 格式正确
5. **F005**: session-analyzer 在空目录 + fake log 上不崩溃
6. **F006**: 可视化测试报告，用 agentlint-report.tsx 同款设计，数据来自 F001-F005 真实结果
7. **总结**: 所有用户可触达的路径（install → scan → score → plan → fix → report → deep-analyze → session-analyze）都有测试证据，且有可展示的验证报告

## Constraints

- 全 corpus 打包可能 > 50MB — 不提交 git，本地生成
- Docker full-corpus 测试可能跑 10-20 分钟 — 不加入 CI 快速测试，作为 release 前手动验证
- Deep analyzer 测试不调用真实 AI — 只验证 prompt 生成
- Session analyzer 测试用 fake log — 不读用户真实 session 数据

## Decision Log

- 2026-04-04: 全 corpus 测试选 Docker 而非本地。原因：(1) 不碰本地环境 (2) 同时测 Linux 兼容性 (3) 可重复
- 2026-04-04: Deep analyzer 不测 AI 质量，只测 prompt 生成。原因：AI 输出不确定，测它需要 AI judge，复杂度高且不稳定。Prompt 格式正确 = 接口层没 bug，AI 质量是模型的事。
- 2026-04-04: Session analyzer 用 fake log 而非真实 log。原因：真实 log 在用户本地，不能打包进 Docker；且测试目的是代码健壮性不是分析质量。
