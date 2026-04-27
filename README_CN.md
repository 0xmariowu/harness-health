<div align="center">

<h1>AgentLint</h1>

<p><strong>AI agent harness 的 linter。</strong></p>
<p><em>ESLint 检查人类写的代码。<br/>AgentLint 检查 agent 读的上下文。</em></p>

[![CI](https://github.com/0xmariowu/AgentLint/actions/workflows/ci.yml/badge.svg)](https://github.com/0xmariowu/AgentLint/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/0xmariowu/AgentLint)](https://github.com/0xmariowu/AgentLint/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Checks](https://img.shields.io/badge/checks-58-00b48c)](#检查项目)
[![npm](https://img.shields.io/npm/v/agentlint-ai)](https://www.npmjs.com/package/agentlint-ai)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-cc785c)](https://claude.com/download)

<p><a href="https://www.agentlint.app/zh"><strong>🌐 中文站</strong></a> · <a href="https://www.agentlint.app/zh/blog">博客</a> · <a href="#安装">安装</a> · <a href="#效果展示">效果展示</a> · <a href="#harness-问题">Harness 101</a> · <a href="#检查项目">检查项目</a> · <a href="#数据来源">数据来源</a> · <a href="#faq">FAQ</a></p>

</div>

---

> **Agent = 模型 + Harness。** 现在瓶颈不在模型，在 harness。
>
> 你的 `AGENTS.md`、`CLAUDE.md`、CI 配置、hooks、`.gitignore` ——这些就是 harness。写错了，Claude Code、Cursor、Codex 交付的是 AI 垃圾。写对了，agent 会越来越强。
>
> AgentLint 用 **51 个确定性的核心检查（6 个核心维度）**，再加上 **7 个可选扩展检查**（Deep + Session，靠 AI 子 agent 和 Claude Code 本地日志跑），一共 58 项检查，全部有数据支撑、零主观意见。

> 📚 **完整文档、20+ 篇长文、以及 check 目录都在 [agentlint.app/zh](https://www.agentlint.app/zh)。** 推荐阅读：[写好 CLAUDE.md](https://www.agentlint.app/zh/blog/writing-a-good-claude-md) · [每份 CLAUDE.md 都该通过的 33 项 checks](https://www.agentlint.app/zh/blog/the-33-checks-every-claude-md-should-pass) · [AGENTS.md vs CLAUDE.md](https://www.agentlint.app/zh/blog/agents-md-vs-claude-md) · [English blog](https://www.agentlint.app/blog).

## 安装

```bash
npm install -g agentlint-ai
```

然后在任何 git repo 里：

```bash
agentlint check
```

在 Claude Code 里：运行 `/al`，进入交互式扫描、修复、报告流程。

> **使用 AI 编程 agent？** 让它读 [INSTALL.md](./INSTALL.md) —— 这份文档就是为了读一次后直接执行。

## 效果展示

```
$ /al

AgentLint — Score: 72/100 (core)

Findability      ██████████████░░░░░░  7/10
Instructions     ████████████████░░░░  8/10
Workability      ████████████░░░░░░░░  6/10
Safety           ██████████░░░░░░░░░░  5/10
Continuity       ██████████████░░░░░░  7/10
Harness          ████████████████████  10/10
Deep             ░░░░░░░░░░░░░░░░░░░░  n/a   (opt-in)
Session          ░░░░░░░░░░░░░░░░░░░░  n/a   (opt-in)

Fix Plan（7 项）：
  [guided]   将 8 个 GitHub Actions 固定到 SHA（供应链风险）
  [guided]   将 .env 加入 .gitignore（AI 会读到你的 secrets）
  [assisted] 生成 HANDOFF.md
  [guided]   减少 IMPORTANT 关键词（找到 7 个，Anthropic 用 4 个）

选择修复项 → AgentLint 自动修复 → 重新打分 → 保存 HTML 报告
```

## Harness 问题

2026 年 2 月，Mitchell Hashimoto（HashiCorp）提出了这个概念。OpenAI 的 Ryan Lopopolo 随后将其正式化。LangChain 的 Vivek Trivedy 给出了最简洁的定义：

> **Agent = 模型 + Harness。** 如果你不是模型，你就是 harness。

**Harness** 是包裹 LLM、将其变成 agent 的所有代码、配置和指令。对于编程 agent，你的 harness 包括：

- `AGENTS.md` / `CLAUDE.md` — 每次 session 开始时注入的持久规则
- `.cursor/rules/`、`.github/copilot-instructions.md` — 工具特定的指令层
- CI、pre-commit hooks、`.gitignore` — agent 无法绕过的确定性约束
- `SECURITY.md`、changelog、handoff 文件 — 跨 session 存活的上下文

**Harness 工程**就是设计这些组件，让 agent 在数百次工具调用中保持可靠，而不仅仅是前十次。

研究数据很直白：

- Anthropic **2026 年 Agentic Coding Trends Report**：维护良好 context 文件的团队，"糟糕建议 session"减少 **40%**
- **DORA 2025 State of AI-Assisted Software Development**：同样的结论——AI 是放大器，harness 好的团队被加速，harness 差的团队被放大问题
- **ETH Zurich 研究**：*自动生成*的 context 文件在测试的 8 种场景中有 5 种**降低**了 agent 成功率，还将推理成本提高了 **20–23%**
- 一项随机对照实验发现：使用 AI 的开发者在复杂任务中比不用 AI **慢 19%**——但他们认为自己快了 20%
- LangChain 2026 年 2 月报告：**70% 的 agent 性能取决于模型以外的部分**。相同的权重，不同的 harness，结果截然不同。

结论：糟糕的 harness 比没有 harness 更糟。而几乎没人知道好的 harness 是什么样的。

**AgentLint 是第一个专门审计 harness 层的 linter。**

## AgentLint 有什么不同

每项检查都有数据支撑，没有主观意见。这些数据来自大多数开发者从未关注的地方：

- **265 个版本**的 Anthropic 官方 Claude Code 系统提示——我们追踪了他们添加、删除和重写的每一个词。当他们把 `IMPORTANT` 从 12 次削减到 4 次，我们知道。当他们删除所有"你是一个有帮助的助手..."身份描述，我们知道。
- **Claude Code 源码**——这是 harness 硬性限制的所在。超过 40,000 字符的入口文件会被静默截断；超过 256 KB 的文件根本无法读取；运行过慢的 pre-commit hook 会导致 commit 永远挂起，因为 Claude Code 从不使用 `--no-verify`。
- **真实生产环境审计**——来自开源代码库，记录了 agent 反复踩中的安全漏洞。
- **6 篇学术论文**——关于指令遵循、context 文件效果和文档衰减。

一项检查如果找不到数据来源，就不会发布。

## 检查项目

**共 58 项检查：51 项核心检查（6 个核心维度，默认跑）+ 7 项扩展检查**（Deep 3 项 AI 分析 + Session 4 项日志读取，默认不跑）。`agentlint check` 和 GitHub Action 默认只跑 51 项核心检查——扩展检查需要 AI 子 agent 或 Claude Code 本地日志，只能在 Claude Code 里通过 `/al` 选 opt-in。

总分只在实际跑过的维度里算平均。默认 CI 跑出来会显示 `Score: NN/100 (core)`，Deep/Session 标成 `n/a`，不会被当成 `0/10` 扣分。如果把扩展分析也跑了，头部会显示 `(core+extended)`。

### 🔍 Findability — AI 能找到它需要的吗？*(20%)*

| 检查 | 内容 | 原因 |
| --- | --- | --- |
| F1 | 入口文件存在 | 没有 CLAUDE.md / AGENTS.md = AI 从零开始 |
| F2 | 前 10 行有项目描述 | AI 需要在规则之前先了解上下文 |
| F3 | 有条件加载指导 | "处理 X 时读 Y"防止 context 臃肿 |
| F4 | 大目录有 INDEX 文件 | 超过 10 个文件没有索引 = AI 全部读一遍 |
| F5 | 所有引用可解析 | 死链接浪费 token 读到死路 |
| F6 | 标准文件命名 | README.md、CLAUDE.md 会被自动发现 |
| F7 | `@include` 指令可解析 | 缺失的目标会被静默忽略——你以为加载了，其实没有 |
| F8 | 规则文件 frontmatter 使用 glob | `.cursor/rules/` MDC 文件应匹配 glob 模式，而非精确路径 |
| F9 | 无未填充的模板占位符 | 留在 context 文件中的 `{{变量}}` 浪费 token 并混淆模型 |

### 📝 Instructions — 你的规则写得好吗？*(25% — 权重最高)*

| 检查 | 内容 | 原因 |
| --- | --- | --- |
| I1 | 强调关键词数量 | Anthropic 在 265 个版本中将 `IMPORTANT` 从 12 次削减到 4 次 |
| I2 | 关键词密度 | 强调越多 = 遵守越少。Anthropic：7.5 → 1.4 个/千字 |
| I3 | 规则具体性 | "不要 X。改用 Y。因为 Z。"——Anthropic 的黄金公式 |
| I4 | 面向行动的标题 | Anthropic 删除了所有"你是..."身份描述章节 |
| I5 | 无身份描述语言 | "遵循惯例"被删除了——模型本来就会这样做 |
| I6 | 入口文件长度 | 60–120 行是最佳区间，更长则稀释优先级 |
| I7 | 不超过 40,000 字符 | Claude Code 硬性限制，超过则被静默截断 |
| I8 | 总注入内容在预算内 | 所有自动注入文件保持在 200K context 预算内 |

### 🔨 Workability — AI 能构建和测试吗？*(18%)*

| 检查 | 内容 | 原因 |
| --- | --- | --- |
| W1 | 记录了构建/测试命令 | AI 无法猜测你的测试运行器 |
| W2 | 存在 CI | 没有执行的规则只是建议 |
| W3 | 测试存在且非空 | 运行 `pytest` 但 0 个测试文件的 CI 永远"通过" |
| W4 | 配置了 linter | 机械格式化让 AI 不用猜测代码风格 |
| W5 | 没有超过 256 KB 的文件 | Claude Code 无法读取——硬性错误 |
| W6 | Pre-commit hooks 运行快 | Claude Code 从不用 `--no-verify`，慢 hook = commit 卡死 |
| W7 | 记录了本地快速测试命令 | 入口文件记录 <30s 的测试命令，供 session 中途验证 |
| W8 | 存在 npm test 脚本 | JS/Node 项目需要 `npm test`，让 AI 无需猜测如何运行测试 |
| W9 | Release 工作流验证版本一致性 | 跨 package.json、CHANGELOG 和 badge 的自动版本漂移检测 |
| W10 | 定义了测试成本分级（pytest markers） | `@pytest.mark.fast` 让 AI 运行廉价子集，而非 10 分钟全套 |
| W11 | feat/fix commit 必须配套 test commit | 捕获没有对应测试就合入的功能 |

### 🔄 Continuity — 下个 session 能接上吗？*(12%)*

| 检查 | 内容 | 原因 |
| --- | --- | --- |
| C1 | 文档新鲜度 | 过时的指令比没有指令更糟糕 |
| C2 | 存在 handoff 文件 | 没有它，每个 session 都从零开始 |
| C3 | Changelog 记录了"为什么" | "更新了 INDEX"什么都没说。"修复了死链接"说明了一切 |
| C4 | 计划文件在 repo 中 | 放在 Jira 里的计划对 AI 不存在 |
| C5 | `CLAUDE.local.md` 未纳入 git | 每用户私有文件——必须在 `.gitignore` 中 |
| C6 | HANDOFF.md 包含验证条件 | 带证据（`分数 ≥ X`、`测试通过`）的交接文件让下个 session 跳过完整重审 |

### 🔒 Safety — AI 在安全地工作吗？*(15%)*

| 检查 | 内容 | 原因 |
| --- | --- | --- |
| S1 | `.env` 在 `.gitignore` 中 | AI 的 Glob 工具默认忽略 `.gitignore`——secrets 可见 |
| S2 | Actions SHA 已固定 | AI push 触发 CI。浮动 tag = 供应链攻击向量 |
| S3 | 配置了 secret 扫描 | AI 不会自查是否意外写入了 API key |
| S4 | 存在 `SECURITY.md` | AI 在处理敏感代码时需要安全上下文 |
| S5 | 工作流权限最小化 | AI 触发的工作流不应默认有写权限 |
| S6 | 没有硬编码的 secrets | 检测源码中的 `sk-`、`ghp_`、`AKIA`、私钥等模式 |
| S7 | 源码中没有个人路径 | 硬编码的 home 目录绝对路径泄露机器身份，在其他机器上会出错 |
| S8 | 没有 `pull_request_target` 触发器 | 在特权上下文中运行——外部 PR 的供应链攻击向量 |
| S9 | git 历史中没有个人邮箱 | commit 中的个人邮箱是隐私和身份泄露 |

### ⚙️ Harness — 你的 Claude Code 配置正确吗？*(10%)*

| 检查 | 内容 | 原因 |
| --- | --- | --- |
| H1 | Hook 事件名称有效 | `PoToolUse` vs `PostToolUse`——拼写错误会让 hook 永远不触发 |
| H2 | PreToolUse hooks 有匹配器 | 没有工具匹配器，hook 会在*每次*工具调用前运行 |
| H3 | Stop hook 有熔断器 | 没有退出条件的 Stop hook 会永远运行 |
| H4 | 没有危险的自动批准 | `*` 或 `.*` 让 agent 在无人检查的情况下执行任意工具 |
| H5 | Env deny 覆盖完整 | 缺失的 deny 规则让含 secrets 的环境变量泄露给不受信任的工具 |
| H6 | Hook 脚本网络访问 | Hook 中的出站调用可以在 agent 触发时泄露数据 |
| H7 | Gate 工作流是阻塞式的 | 仅警告的 CI gate 实际上相当于禁用——agent 依然合并失败的代码 |
| H8 | Hook 错误使用结构化格式 | `what/rule/fix` 让 agent 自我纠正；非结构化错误让它卡住 |

### 🧠 Deep — AI 驱动的指令分析 *(可选扩展)*

生成 AI 子 agent 来发现模式匹配找不到的问题：

| 检查 | 内容 | 原因 |
| --- | --- | --- |
| D1 | 矛盾规则 | 两条冲突的规则让模型自行选择——通常选错 |
| D2 | 无效规则 | 模型本来就会遵循的规则浪费 token、稀释优先级 |
| D3 | 没有决策边界的模糊规则 | "用好的判断力"给了模型没有任何可评估的依据 |

### 📊 Session — 从 Claude Code 日志中学习 *(可选扩展)*

读取你的 session 历史，发现你自己不会注意到的规律：

| 检查 | 内容 | 原因 |
| --- | --- | --- |
| SS1 | 重复指令 | 每个 session 都输入的指令应该放进 `CLAUDE.md` |
| SS2 | 被忽略的规则 | AI 反复绕过的规则需要重写，而不是重复 |
| SS3 | 摩擦热点 | 哪些项目和任务产生了最多的重复工作 |
| SS4 | 缺失规则建议 | 还没有记录在任何地方的常见纠正 |

## 这和 `/init` 有什么区别？

`/init` 从头生成一个模板 `CLAUDE.md`。第一天有用。**第 50 天没用**——那时文件已经过时、塞满了模型忽略的强调关键词、`.env` 没加进 `.gitignore`、还静默超过了 40K 字符限制。

`/init` 写文件。AgentLint 审计整个系统：

| | `/init` | AgentLint |
|---|:---:|:---:|
| 生成模板 `CLAUDE.md` | ✅ | — |
| 检查入口文件质量 | — | ✅ |
| 发现损坏的 `@include` 引用 | — | ✅ |
| 强制执行 40K 字符硬性限制 | — | ✅ |
| 审计 CI、hooks、`.gitignore`、Actions SHA 固定 | — | ✅ |
| 检测时间累积的指令腐化 | — | ✅ |
| 审计 Claude Code hook 配置 | — | ✅ |
| 自动修复能修的问题 | — | ✅ |
| 每项检查都有数据来源 | — | ✅ |

## 适合哪些人

- **独立开发者**：使用 Claude Code、Cursor 或 Codex，想让 agent 停止忽略你的规则
- **团队 Lead**：需要组织内所有 repo 在 agent 上线前达到 AI-ready 状态
- **开源维护者**：外部贡献者（及其 agent）应该按你的风格写代码
- **安全意识强的工程师**：担心 agent 泄露 `.env` 或触发有漏洞的工作流

## 兼容性

AgentLint 作为 **Claude Code 插件**和独立 **CLI** 发布。运行时，它会审计 repo 中存在的以下任意文件：

- `CLAUDE.md`（Anthropic 的 Claude Code）
- `AGENTS.md`（通用标准——被 OpenAI Codex、Cursor、Windsurf、Kilo、GitHub Copilot、Gemini CLI 和 [60,000+ 开源 repo](https://agents.md/) 使用）
- `.cursor/rules/`
- `.github/copilot-instructions.md`

**路线图：** 原生 Cursor 和 Codex 集成。[Star 本 repo](https://github.com/0xmariowu/AgentLint) 跟进进展。

## 更新

```bash
npm install -g agentlint-ai
```

或直接更新 Claude Code 插件：

```bash
claude plugin update agent-lint@agent-lint
```

## 数据来源

每项检查都引用了来源。没有主观意见，没有"最佳实践"——只有数据。

| 来源 | 类型 |
| --- | --- |
| [Anthropic 265 个提示版本](https://cchistory.mariozechner.at) | 主要数据集 |
| Claude Code 源码 | 硬性限制和内部行为 |
| [IFScale（NeurIPS）](https://arxiv.org/abs/2507.11538) | 大规模指令遵循研究 |
| [ETH Zurich](https://arxiv.org/abs/2602.11988) | Context 文件对编程 agent 有效吗？ |
| [Codified Context](https://arxiv.org/abs/2602.20478) | 过时内容是最主要的失败模式 |
| [Agent READMEs](https://arxiv.org/abs/2511.12884) | 具体 vs 抽象指令的效果对比 |

完整引用见 [`standards/evidence.json`](https://github.com/0xmariowu/AgentLint/blob/main/standards/evidence.json)。

## FAQ

<details>
<summary><strong>"agent harness" 到底是什么？</strong></summary>

这个概念在 2026 年初流行起来（Mitchell Hashimoto、OpenAI、LangChain）。最简短的定义：<strong>Agent = 模型 + Harness</strong>。Harness 是包裹 LLM 并将其变成 agent 的一切——工具、状态管理、反馈循环，以及它在 session 开始时读取的持久规则。对于编程 agent，后者就是你的 <code>AGENTS.md</code>、<code>CLAUDE.md</code>、<code>.cursor/rules</code>、CI、pre-commit hooks 和 <code>.gitignore</code>。AgentLint 是第一个专门审计这一层的 linter。
</details>

<details>
<summary><strong>为什么不直接用 <code>/init</code> 了事？</strong></summary>

见上面的对比表。`/init` 写文件；它不审计你的 repo。AgentLint 做 51 项核心检查（6 个核心维度）+ 7 项可选扩展检查——并修复它发现的问题。
</details>

<details>
<summary><strong>这能用于 Cursor、Codex 或 GitHub Copilot 吗？</strong></summary>

今天 AgentLint 在 Claude Code *内部*运行，但检查项目适用于每个 agent 都会读取的 repo 资源：`AGENTS.md`、`.cursor/rules`、`.github/copilot-instructions.md`。一个通过 linting 的 repo 让所有 agent 都更好，不只是 Claude。原生 Cursor 和 Codex 集成在路线图上。
</details>

<details>
<summary><strong>我的代码会被发送到任何地方吗？</strong></summary>

看你跑的是哪种模式。默认模式（`agentlint check` 和 GitHub Action）纯本地、不调用 AI。两个 opt-in 扩展模式会接触 AI 或本地 session 日志——我们把细节写清楚，避免意外：

| 模式 | 读取的数据 | 网络 / AI |
|------|----------|----------|
| `agentlint check`（默认）| 被扫描 repo 里的文件 | **纯本地，无 AI** |
| GitHub Action | runner 里 checkout 的 repo 文件 | **纯本地，无 AI** |
| `/al`（仅 core 维度）| 配置的 `PROJECTS_ROOT` 下的 git repo | **纯本地，无 AI** |
| `/al` + Deep（opt-in）| 选中的入口文件（如 `CLAUDE.md`）| **把文件内容发送给 Claude sub-agent** |
| `/al` + Session（opt-in）| 你机器上的 `~/.claude/projects/` 日志 | 本地分析。输出默认脱敏，原文片段需要 `--include-raw-snippets` |

只有 Deep 模式会把文件内容传出你的机器，而且必须在 Claude Code 里显式 opt-in 才会跑。默认 scan 产出的一切（`Score: NN/100 (core)` 输出、JSONL、SARIF、GitHub Action 标注）全都来自磁盘上的 pattern 检查，不打 API。
</details>

<details>
<summary><strong><code>npm install</code> 会在 node_modules 之外写东西吗？</strong></summary>

**会，故意的。**`npm install -g agentlint-ai` 跑的 `postinstall` 脚本检测到有 Claude Code 时会自动在 `~/.claude/` 注册 `/al` 插件。这是有意的 UX 决定——AgentLint 是 Claude Code 原生工具，"装完即可 /al" 是用户期望。

失败场景的备用做法见 [INSTALL.md](./INSTALL.md)。
</details>

<details>
<summary><strong>这不就是"最佳实践"吗？</strong></summary>

不是。每项检查都引用了具体来源——Anthropic 的 265 个提示版本、Claude Code 源码、同行评审论文，或真实生产环境审计。如果一项检查找不到数据支撑，它就不会发布。
</details>

<details>
<summary><strong>这是 Claude Code 插件，为什么还要 lint <code>AGENTS.md</code>？</strong></summary>

因为好的 context 工程是跨工具的。如果你同时使用 Claude Code、Cursor 和 Codex，同一个 `AGENTS.md` 服务于所有这些工具。AgentLint 用相同的证据库检查它，无论哪个 agent 最终读取它。
</details>

<details>
<summary><strong>扫描需要多长时间？</strong></summary>

大多数 repo 不到 5 秒。Deep 和 Session 维度需要更长时间，因为它们会生成子 agent 或读取 session 日志。
</details>

## 要求

- Node 20+
- `jq`
- [Claude Code](https://claude.com/download)（用于 `/al` 插件和 Deep/Session 分析）

## 贡献

欢迎提 issue 和 PR。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)

---

<div align="center">

**如果 AgentLint 让你避免了一次糟糕的 agent session，请 [⭐ star 这个 repo](https://github.com/0xmariowu/AgentLint)** — 这是我们了解它是否有用的方式。

<sub>由 <a href="https://github.com/0xmariowu">@0xmariowu</a> 构建 · <a href="https://www.agentlint.app/">agentlint.app</a></sub>

</div>
