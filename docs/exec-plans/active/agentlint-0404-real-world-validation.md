# AgentLint Real-World Validation

## Goal

让 AgentLint 经过严格的真实环境测试后再交给用户。验证四件事：(1) scanner 不会在奇怪的 repo 上崩溃，(2) 每个 check 的结果是准确的，(3) fixer 不会破坏用户文件，(4) 总分能反映 repo 的真实 AI 友好程度。

## Background

现有测试：24 unit + 45 E2E，全部用的合成 fixture。Fixture 只能测 "代码逻辑对不对"，测不了 "真实世界会不会出问题"。已知教训：F5 在 bun 上删了 75 行有效内容 — fixture 没发现，10 个真实 repo 才暴露。

可用数据：
- Armory sources：148 个完整 git repo，其中 53 个有 CLAUDE.md
- 本地项目：9 个 `~/Projects/*`

## Features

### F001: Scanner 鲁棒性 — 各种奇怪 repo 不崩溃 — done

目的：用户的 repo 什么样都有。Scanner 必须在所有情况下安全退出、产出有效 JSONL — 即使 repo 结构很离谱。

方法：构造 12 种边界 repo，加上 Armory 里的 148 个真实 repo，全部跑 scanner。用 `timeout` 检测 hang，用 exit code 检测 crash。

#### Steps

- [ ] S1: 写 `tests/robustness/make-edge-repos.sh` — 构造 12 种边界 repo ← verify: 目录存在，每种都是独立的 git repo
  - 边界类型：
    1. 空 repo（git init，无文件）
    2. 纯二进制 repo（只有 .png / .wasm）
    3. 超大 CLAUDE.md（50K chars，超 40K 限制）
    4. 超深嵌套（10 层 directory）
    5. 文件名含空格和 unicode（`项目 说明.md`）
    6. symlink 指向不存在的目标
    7. 没有 .git 的普通目录
    8. monorepo（3 个子项目，各有 CLAUDE.md）
    9. 只有 AGENTS.md 没有 CLAUDE.md
    10. CLAUDE.md 是 symlink 指向另一个文件
    11. 非 UTF-8 编码的 markdown
    12. `.github/workflows/` 里的 YAML 语法错误
- [ ] S2: 写 `tests/robustness/run-scanner-robustness.sh` — 对每个边界 repo + Armory 148 repos 跑 scanner ← verify: 全部 pass（0 crash、0 hang、0 invalid JSONL），任何失败有 issue 记录
  - 具体执行方式：`timeout 30 bash src/scanner.sh <repo-path>`
  - 判定标准：
    - exit code 0 或 1 = pass（正常退出）
    - exit code 124 = hang（timeout 杀掉）= FAIL
    - exit code 130/137/139 = crash（signal kill）= FAIL
    - stdout 用 `jq -e . >/dev/null 2>&1` 验证是否 valid JSONL（每行独立验证）
  - 输出 `tests/robustness/results.json`：每个 repo 的 exit_code + runtime_ms + jsonl_valid
- [ ] S3: 修复 S2 发现的所有 crash/hang（depends: S2）← verify: 重跑 S2 全绿

### F002: Check 准确性 — 31 个 check 在真实 repo 上的 false positive / false negative — done

目的：用户最先看到的是每个 check 的结果。一个 false positive（好 repo 被标红）直接损害信任。一个 false negative（烂 repo 全绿）让产品无价值。需要系统性验证每个 check。

方法：选 20 个真实 repo（Armory sources），人工标注每个 check 的期望结果（pass / fail / N/A），然后跑 scanner 对比。偏差就是 bug。

#### Steps

- [ ] S1: 从 Armory 148 repos 中选 20 个多样性样本，保存列表到 `tests/accuracy/repos.json` ← verify: 20 个 repo 覆盖以下多样性维度
  - 选择标准：
    - 有 CLAUDE.md 的：10 个（含大/中/小文件）
    - 有 AGENTS.md 的：3 个
    - 两者都没有的：4 个
    - 有 .cursorrules 的：3 个
    - 语言覆盖：JS/TS, Python, Go, Rust 至少各 1 个
    - 有 GitHub Actions 的：至少 10 个
    - 有 .env 文件的：至少 3 个
    - **CI 质量多样性**：至少 3 个 repo 的 Actions 用 floating tag（不是 SHA pin），至少 2 个 workflow 有 `permissions:` 问题（过宽或缺失）— 确保 S2, S5 不是只测 "有/无 CI" 而是测检测逻辑的准确性
- [ ] S2: 先写 `tests/accuracy/check-spec.md` — 从 `src/scanner.sh` 提取每个 check 的判定逻辑，写成人可执行的规则（depends: S1）← verify: 31 个 check 每个有明确的 pass/fail 条件，条件可以用 shell 命令验证
  - 为什么不用 `standards/evidence.json`：evidence.json 是论文引用，不是判定规则。scanner.sh 才是真正的判定逻辑。标注必须基于 scanner 的实际逻辑，否则偏差 = 标注错误而非 scanner bug。
- [ ] S3: 对 20 个 repo 人工标注 `tests/accuracy/labels.json` — 按 check-spec.md 的规则逐条标注（depends: S1 + S2）← verify: JSON schema 合法，每个 repo 有 31 个 check 的 label（pass/fail/na/uncertain）
  - 标注规则（避免主观偏差）：
    - 每个 check 按 check-spec.md 的判定条件标注，不凭感觉
    - 不确定的标 `uncertain`，不强行判断
    - 标注时不看 scanner 输出（盲测）
- [ ] S4: 写 `tests/accuracy/run-accuracy.sh` — 跑 scanner → 和 labels.json 对比 → 输出 confusion matrix（per check）（depends: S1 + S3）← verify: 输出 31 行，每行有 check_id + TP + FP + FN + TN + accuracy。`uncertain` 标注不计入 accuracy 统计。
- [ ] S5: 对 accuracy < 80% 的 check 做根因分析 + 修复（depends: S4）← verify: 重跑 S4，所有 check accuracy >= 80%，或者有明确的 "已知限制" 记录
- [ ] S6: 把 20 repos 的 expected labels 固化成回归测试（depends: S4）← verify: `tests/test-accuracy.sh` 存在，被 `tests/test-e2e.sh` 调用，CI workflow 包含它

### F003: Fixer 安全性 — 在真实 repo 上跑 fixer，检测意外修改 — done

目的：fixer 直接改用户文件。F5 事件证明这会出问题。需要在大量真实 repo 上验证 fixer 只改该改的。

方法：对 Armory 53 个有 CLAUDE.md 的 repo + 20 个 F002 样本 repo 跑完整 pipeline（scan → score → plan → fix），用 git diff 检测所有修改。

已知风险点：fixer 有 4 个 check 会修改文件：
- **I5**（auto）：删除 CLAUDE.md 里的 identity language
- **F5**（plan-generator 按 score 分 assisted/guided，fixer fallback 为 auto）：删除 broken references 所在行
- **F1**（assisted）：创建 CLAUDE.md starter
- **C2**（assisted）：创建 HANDOFF.md starter

注意：plan-generator 里 F5 不在 AUTO_FIXES set 里（只有 I5 在）。F5 按 score < 0.5 → assisted，否则 guided。但 fixer 的 DEFAULT_ITEM_IDS 里 F5 = auto。测试必须确保 F5 在两种路径下都被覆盖。

#### Steps

- [ ] S0: 校准 RED FLAG 阈值 — 跑 fixer 的 F5 路径在 5 个有已知 broken refs 的 repo 上，记录每个 repo 的实际删除行数（depends: F002.S1）← verify: `tests/fixer-safety/calibration.json` 有 5 个数据点，记录 broken ref count 和 deleted line count
- [ ] S1: 写 `tests/fixer-safety/run-fixer-safety.sh` ← verify: 对 oven-sh/bun, tldraw, n8n-io/n8n 3 个 Armory repo 跑通，产出 diff
  - 对每个 repo：
    1. `cp -r` 到 `/tmp/al-validation/`
    2. 跑 scanner → scorer → plan-generator
    3. **分两轮跑 fixer**：
       - 轮 1：apply plan-generator 输出的所有 auto + assisted items（正常 pipeline 路径）
       - 轮 2：强制 apply F5（不论 plan-generator 怎么分类）— 测 F5 的 worst case
    4. 每轮单独 `git diff --stat` + `git diff` 保存
  - 这样确保 F5 一定被测到，不管 plan-generator 怎么分类
- [ ] S2: 写 `tests/fixer-safety/analyze.js` — 分析所有 diff，按 check_id 分类统计（depends: S0 + S1）← verify: 输出 JSON 包含 per-repo summary + per-check aggregate + RED FLAG 列表
  - RED FLAG 条件：
    - 单个 repo 删除行数 > S0 校准值的 2x（而非固定 5 行）
    - 修改了非 markdown 文件
    - 创建的文件内容包含 hardcoded path（`/Users/`、`/home/`）
    - fixer 退出码非 0
- [ ] S3: 跑全量 53 + 20 repos（depends: S1 + S2）← verify: 全部完成，summary.json 存在
- [ ] S4: 人工审查所有 RED FLAG + 随机抽检 10 个 clean diff（depends: S3）← verify: 每个 RED FLAG 有 resolution（false-positive / real-bug / by-design），随机抽检无意外
- [ ] S5: 修复发现的 real-bug + 回归测试（depends: S4）← verify: 回归测试覆盖每个 bug，重跑 S3 RED FLAG 数量减少

### F004: 分数校准 — 分数是否反映真实 AI 友好程度 — done

目的：AgentLint 的核心产品 claim 是 "分数高 = AI 干活顺"。如果一个烂 repo 得 85 分、一个好 repo 得 40 分，产品就没有意义。

方法：选 15 个 repo，人工分成 3 个 tier（A/B/C），跑 AgentLint 打分，检查 tier 之间的分数是否有显著差异。再用 9 个本地项目交叉验证。

#### Steps

- [ ] S1: 从 Armory + 本地项目选 15 个 repo，人工评 tier ← verify: `tests/calibration/tiers.json` 存在，每个 repo 有 tier(A/B/C) + 理由
  - Tier A（AI 友好）：有 CLAUDE.md + 结构清晰 + CI + 测试 + handoff — 5 个
  - Tier B（一般）：有部分基础设施，缺关键件 — 5 个
  - Tier C（不友好）：无 entry file / 无 CI / 无测试 — 5 个
  - 评 tier 时不看 AgentLint 分数（盲测）
- [ ] S2: 对 15 repos 跑 scanner + scorer，保存分数到 `tests/calibration/scores.json`（depends: S1）← verify: 每个 repo 有总分 + 5 维度分
- [ ] S3: 写 `tests/calibration/analyze.js` — 计算 tier 间分数差异（depends: S1 + S2）← verify: 输出包含以下全部字段
  - Tier A 平均分 vs Tier B vs Tier C
  - 是否 A > B > C（单调递减）
  - 重叠度：A 的最低分 vs C 的最高分是否有交叉
  - 各维度分别的区分度（哪个维度最有区分力）
  - 异常 case：tier 和分数不一致的 repo + 分析
- [ ] S4: 用本地 9 个项目做交叉验证（depends: S3）← verify: 9 个项目都有 tier 标注 + 分数，且满足：Tier A 平均分 > Tier B 平均分 > Tier C 平均分（可以和外部 repo 混合计算）。如果某个本地 Tier A 项目得分低于外部 Tier C 中位数，标记为异常并分析原因。
- [ ] S5: 如果 tier 之间没有显著差异（A/C overlap > 30%）→ 调查 weight/check 问题，提出修正方案（depends: S3）← verify: 修正后重跑 S3，overlap < 15%

## Constraints

- 所有测试在 repo 副本上跑（cp 或 clone），**绝不碰原始数据**
- 临时文件放 `/tmp/al-validation/`，测试后清理
- 人工标注遵守盲测原则：标注时不看 scanner/scorer 输出
- 每个 feature 的 harness 脚本要可重复跑（幂等），方便 CI 集成
- 回归测试通过 `tests/test-e2e.sh` 入口跑（项目无 `npm test` script，测试都走 shell）

## Data Sources

| Source | Location | Count | Usage |
|--------|----------|-------|-------|
| Armory repos（有 .git） | `~/Armory/sources/` | 148 | F001 鲁棒性、F003 fixer 安全 |
| 其中有 CLAUDE.md 的 | 同上 | 53 | F002 准确性、F003、F004 |
| 本地项目 | `~/Projects/` | 9 | F004 分数校准 |
| 合成边界 repo | `tests/robustness/repos/` | 12 | F001 鲁棒性 |

## Execution Order

```
F001 (鲁棒性)  →  F002 (准确性)  →  F003 (fixer 安全)  →  F004 (分数校准)
    ↑                  ↑                    ↑                    ↑
 先确保不崩溃      再验证结果对       再验证修改安全       最后验证分数有意义
```

F001 必须先做 — scanner 崩溃的话后面全白搭。F002 和 F003 可以部分并行（共享 repo 列表）。F004 最后 — 需要 F002 确认 check 准确后，分数才有意义。

## Success Criteria

1. **F001**: scanner 在 160 repos（12 边界 + 148 Armory）上 0 crash、0 hang（timeout 30s）
2. **F002**: 31 checks × 20 repos，整体 accuracy >= 85%，无 check 低于 70%
3. **F003**: 73 repos 跑 fixer 后 0 个未解决的 RED FLAG
4. **F004**: Tier A 平均分 > Tier B > Tier C，且 A/C overlap < 15%
5. **总结**: 能拿出数据说 "scanner 不崩、check 准确、fixer 安全、分数有意义"

## Decision Log

- 2026-04-04 v1: 原计划只有 fixer 红队 + session replay 两个方向。
- 2026-04-04 v2: 重写为 4 个 feature（鲁棒性、准确性、fixer 安全、分数校准）。原因：
  - Session replay 不可行 — 572 sessions 中 205 个从 ~ 启动（无明确 project），且 repo 状态随时间变化（AgentLint 打当前分数，但 friction 发生在过去），时间错位导致对比无效。
  - 缺了两个更基础的测试：scanner 鲁棒性（崩溃 = 用户立刻流失）和 check 准确性（false positive = 信任崩塌）。
  - Fixer 实际只有 4 个 check 会改文件（I5/F5/F1/C2），但 plan-generator 和 fixer 对 F5 的分类不一致 — 需要显式覆盖两条路径。
  - 增加分数校准（F004）替代 session replay — 用人工 tier 做 ground truth，比 session log 的信号更干净。
- 2026-04-04 v3: Reviewer 反馈后修复 8 个问题：
  - P0: F003 显式列出 4 个 file-modifying checks + 分两轮测 F5（正常路径 + 强制路径）
  - P0: F002 标注改为基于 scanner.sh 逻辑（新增 S2 check-spec.md），不再用 evidence.json
  - P1: F001 增加 `timeout 30` 和 exit code 124 = hang 的明确判定
  - P1: F003 RED FLAG 阈值改为校准值 2x（新增 S0），不再用固定 5 行
  - P1: F002 选样增加 CI 质量多样性要求（floating tags、permissions 问题）
  - P1: F004.S4 交叉验证增加可执行的量化条件
  - P1: 回归测试改为 `tests/test-e2e.sh` 入口（项目无 npm test script）

## Open Questions

- F002 的人工标注要多久？620 个 label 估计需要通读 20 个 repo 的关键文件。先写 check-spec.md 能加速标注（给标注者 checklist），但判断还是得人工。
- F004 如果 tier 间无差异，可能是 weight 问题也可能是 check 问题 — 需要 F002 的准确性数据来区分。
- plan-generator 和 fixer 对 F5 分类不一致（plan-gen 按 score 判，fixer DEFAULT_ITEM_IDS 写死 auto）可能本身就是个 bug — F003 执行时如果两轮结果不一致，需要决定哪个是 intended behavior。
- Session replay 作为未来方向保留：等积累更多 project-specific session logs（从项目目录启动而非 ~），且 repo 加了 git tag 标记 AgentLint 分数的时间点后，可以做时间对齐的相关性分析。
