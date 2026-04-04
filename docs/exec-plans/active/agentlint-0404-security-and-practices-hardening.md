# AgentLint 安全加固 + 规范修复

## Goal

修复安全审计和规范性审查发现的所有问题。分 4 个优先级批次（P1→P3 + docs），每批内部按依赖关系排序。总计 22 个 step，覆盖 2 个 P1 安全漏洞、4 个 Critical 功能问题、8 个 Major 实践问题、剩余 Minor + 文档。

## Features

### F001: [P1] 消除任意代码执行 — W6 hook 静态分析替代执行 — done

**为什么必须修**：scanner.sh 直接 `bash "$hook_file"` 执行目标 repo 的 pre-commit hook。恶意 repo 可以在 hook 里放反向 shell，用户扫一下就中招。这是真实可利用的 RCE。

#### Steps
- [x] S1: 改 W6 检查逻辑 — 删掉 `bash "$hook_file"` 执行，改成静态分析 hook 文件内容来估算速度 ← verify: `grep -r 'bash.*hook_file' src/scanner.sh` 返回空

**改法**：`src/scanner.sh:1073-1075`，把 `hook_time="$(cd "$project_dir" && { time timeout 15 bash "$hook_file"...` 替换为静态分析：
  - 读 hook 文件内容（`cat "$hook_file"`）
  - 用 `grep -qE` 检查是否包含已知慢命令：`tsc`, `eslint --fix`, `prettier --write`, `jest`, `vitest`, `mypy`, `cargo clippy`
  - 包含慢命令 → `hook_time` 估算为高值（如 8）
  - 不包含 → `hook_time` 估算为低值（如 2）
  - 这样同时解决 M6（跨平台 `time` 格式问题）
  - **已知局限**：`npm run lint` 类间接调用不会被检测到（需要追踪 package.json scripts），这个作为后续迭代。先做最简版。

- [x] S2: 加测试覆盖静态分析路径 ← verify: `bash tests/test-scanner.sh` 通过

**测试要求**：在 test-scanner.sh 里新增 fixture repo，分别包含：(a) 含 `eslint --fix` 的 hook → hook_time 应为高值，(b) 只含 `echo hello` 的 hook → hook_time 应为低值，(c) 无 hook → 正常输出 "No pre-commit hook"。用这些 fixture 验证静态分析路径正确。

---

### F002: [P1] 修 GitHub Actions 触发器 — done

**为什么必须修**：公开 repo 用 `pull_request_target` 是安全定时炸弹。现在没直接可利用，但未来任何人加一行 checkout PR head 就完了。

#### Steps
- [x] S1: `pull_request_target` → `pull_request` ← verify: `grep pull_request_target .github/workflows/pr-lint.yml` 返回空

**改法**：`.github/workflows/pr-lint.yml:4`，`pull_request_target` → `pull_request`，保留 `types: [opened, edited, synchronize]`。

---

### F003: [Critical] 修旧命令名 `/hh` — 全部位置 — done

**为什么必须修**：每个装了 plugin 的用户每次 session ��看到错误指引 `/hh`，应该是 `/al`。

涉及两个文件（`scripts/install.sh` 已在 PR #31 修���）：
- `hooks/hooks.json:9` — `running /hh` → `running /al`
- `commands/al.md:6` — `# /hh — AgentLint` → `# /al — AgentLint`

#### Steps
- [x] S1: 修 hooks.json 和 commands/al.md 中所有 `/hh` → `/al` ← verify: `grep -r '/hh' hooks/ commands/` 返回空

---

### F004: [Critical] 修 F5 fix_type 映射 — done

**为什么必须修**：CHANGELOG 说 F5 demoted to assisted，但 `DEFAULT_ITEM_IDS` 还是 `auto`。当 plan item 没带 `fix_type` 时走 fallback 会自动删行。

#### Steps
- [x] S1: `DEFAULT_ITEM_IDS` 里 F5 从 `auto` 改成 `assisted` ← verify: `grep "F5.*auto" src/fixer.js` 返回空

**改法**：`src/fixer.js:14`，`['F5', 'auto']` → `['F5', 'assisted']`

- [x] S2: 加单元测试覆盖 `inferFixType` fallback 路径（目前零覆盖） ← verify: `node tests/test-fixer.js` 通过，新增 case 验证 F5 plan item 不带 fix_type 时返回 `assisted`
- [x] S3: 更新 test-fixer.js 和 test-e2e.sh 中 F5 相关的 `fix_type: 'auto'` 为 `assisted`（depends: S1）← verify: `grep -rn "F5.*auto" tests/` 返回空

---

### F005: [Critical] scanner.sh 加 `set -euo pipefail` — done

**为什么必须修**：主扫描器只有 `set -u`，子命令失败静默继续，输出可能是垃圾数据。一个检查别人 `set -euo pipefail` 的工具自己没做到，说不过去。

**重要**：F001 也改 scanner.sh（W6 区块）。F005 必须在 F001 合并后再做，否则合并冲突。

#### Steps
- [x] S1: scanner.sh 开头 `set -u` → `set -euo pipefail`，排查并修复因 `-e` 导致的合法非零退出（depends: F001 完成）← verify: `bash tests/test-scanner.sh` 全部通过

**改法**：`src/scanner.sh:3`，`set -u` → `set -euo pipefail`。

需要排查的高风险位置（通过 `grep -n 'grep -q\|grep -qE\|find.*grep' src/scanner.sh` 预扫描）：
  - 所有 `grep -q` / `grep -qE` 调用 — 当目标内容不存在时返回 1，需要加 `|| true` 或用 `if` 包裹
  - 所有 `find ... | grep -q` 管道 — find 无结果时 grep 返回 1
  - 所有 `command -v` 调用 — 命令不存在时返回 1
  - `git` 子命令在非 git 目录的调用

执行时先跑 `grep -cn 'grep -q\|grep -qE' src/scanner.sh` 统计数量，逐个检查是否在 `if` 条件内（已安全）还是裸调用（需要守护）。

- [x] S2: 所有测试 shell 脚本统一加 `set -euo pipefail` ← verify: `grep -rL 'set -euo pipefail' tests/ --include='*.sh'` 返回空
- [x] S3: `scripts/install.sh` 的 `set -e` → `set -euo pipefail` ← verify: `head -3 scripts/install.sh` 显示 `set -euo pipefail`

---

### F006: [Critical] 补 CI 测试覆盖 — done

**为什么必须修**：`test-html-report.js` 是 HTML 报告生成的唯一测试但 CI 不跑。坏了也不知道。

#### Steps
- [x] S1: ci.yml 的 test job 加上 `node tests/test-html-report.js` ← verify: `grep 'test-html-report' .github/workflows/ci.yml` 有匹配

**改法**：`.github/workflows/ci.yml:61` 之后加一行 `node tests/test-html-report.js`

- [x] S2: `test-deep-analyzer.sh` 加 CI skip guard — 检查 `$AL_CORPUS_DIR` 环境变量（`tests/test-deep-analyzer.sh:7` 引用的变量名），不存在时输出 `SKIP: AL_CORPUS_DIR not set` 并 exit 0 ← verify: `unset AL_CORPUS_DIR && bash tests/test-deep-analyzer.sh` 输出含 `SKIP` 且 exit code 为 0

注意：`test-session-analyzer.sh` 同理处理，它依赖 `~/.claude/projects` 目录。

---

### F007: [P2] 修 fixer.js 路径遍历 — done

**为什么必须修**：`--project-dir /etc` 可以让 fixer 往任意位置写文件。

#### Steps
- [x] S1: `parseArgs` 里 `path.resolve` 之后加校验 — 检查目标目录包含 `.git` 或项目标志文件 ← verify: `echo '{"items":[]}' | node src/fixer.js --project-dir /tmp --items F1` 报错包含 "Not a git repository"

**改法**：`src/fixer.js:93` 之后加：
```javascript
if (!fs.existsSync(path.join(args.projectDir, '.git'))) {
  throw new Error(`Not a git repository: ${args.projectDir}`);
}
```

- [x] S2: 加测试验证非 git 目录被拒绝 ← verify: `node tests/test-fixer.js` 通过，新增 case

---

### F008: [P2] 修 scanner.sh 文件探测 oracle — done

**为什么必须修**：恶意 CLAUDE.md 里写绝对路径，scanner 用 `[ -e ]` 检查，可以探测系统文件。

#### Steps
- [x] S1: `resolve_reference_exists` 里跳过绝对路径（`/` 开头）的引用 ← verify: 创建 fixture repo，CLAUDE.md 含 `[link](/etc/passwd)`，扫描后 F5 对该引用报 broken（不是 resolved）

**改法**：`src/scanner.sh` 的 `resolve_reference_exists` 函数，在 line 323（`elif [ -e "$ref" ]` 之前）插入：
```bash
# Skip absolute paths — don't probe filesystem outside project
if [[ "$ref" == /* ]]; then
  return 1
fi
```

---

### F009: [P2] 修 HTML 报告 XSS — done

**为什么必须修**：`fix.fix_type` 和 `alVersion` 没用 `esc()` 转义就插入 HTML。PR #32 加了 `esc()` 函数并转义了大部分字段，但这两处遗漏了。

#### Steps
- [x] S1: reporter.js 漏掉的两处插值过 `esc()` ← verify: `grep 'fix_type}' src/reporter.js` 每个匹配行都含 `esc(`；`grep 'alVersion' src/reporter.js` 中模板插值行都含 `esc(`

**改法**（行号基于 PR #32 后的版本）：
- `${fix.fix_type}` → `${esc(fix.fix_type)}`（出现两处：比较和输出）
- `v${alVersion}` → `v${esc(alVersion)}`

---

### F010: [P3] 修 bump-version.sh Python 注入 — done

**为什么必须修**：`$new`、`$PLUGIN`、`$PACKAGE`、`$MARKETPLACE` 直接插入 Python 字符串字面量。虽然当前输入可控，但作为公开 repo 被 fork 后可能被不安全调用。

#### Steps
- [x] S1: 用环境变量替代 shell→Python 字符串插值 — **包含 line 13 和 lines 27-46 两处** ← verify: `grep "'\$" scripts/bump-version.sh` 返回空（不再有 `'$VAR'` 模式）；`scripts/bump-version.sh 0.3.1` 正常工作（验证后 `git checkout scripts/bump-version.sh package.json .claude-plugin/` 回退）

**改法**：
- Line 13: `current=$(python3 -c "import json; print(json.load(open('$PLUGIN'))['version'])")` → `current=$(PLUGIN="$PLUGIN" python3 -c "import json, os; print(json.load(open(os.environ['PLUGIN']))['version'])")`
- Lines 27-46: 所有 `'$PLUGIN'` → `os.environ['PLUGIN']`，`'$PACKAGE'` → `os.environ['PACKAGE']`，`'$MARKETPLACE'` → `os.environ['MARKETPLACE']`，`'$new'` → `os.environ['NEW_VERSION']`。外面用 `PLUGIN="$PLUGIN" PACKAGE="$PACKAGE" MARKETPLACE="$MARKETPLACE" NEW_VERSION="$new" python3 -c "..."` 传入。

---

### F011: [P3] 更新 SECURITY.md — done

#### Steps
- [x] S1: 版本表更新到 0.3.x，加 severity 分级响应时间，加 Session Analysis 数据访问说明（合并原 F013）← verify: `grep '0.3' SECURITY.md` 有匹配；`grep -i 'session' SECURITY.md` 有匹配

**内容**：
- 版本表：`0.3.x | Yes`，`0.2.x | Yes`，`< 0.2 | No`
- 响应时间：Critical（代码执行/数据泄露）24h，其余 48h
- Session Analysis 说明：AgentLint 的 session analysis 模块会读取 `~/.claude/projects/` 下的会话数据来检查 AI 工作模式。这些数据可能包含对话内容和工具输出。

---

### F012: [P3] scanner.sh 中 find -name glob 转义 — done

#### Steps
- [x] S1: `resolve_reference_exists` 里对 `$ref` 做 glob 转义再传给 `find -name` ← verify: `bash tests/test-scanner.sh` 通过

**改法**：在 `resolve_reference_exists` 函数的 `find` 调用前加转义：
```bash
local safe_ref="${ref//\[/\\[}"
safe_ref="${safe_ref//\]/\\]}"
safe_ref="${safe_ref//\*/\\*}"
safe_ref="${safe_ref//\?/\\?}"
```
然后所有 `find ... -name "$ref" ...` 改为 `find ... -name "$safe_ref" ...`

---

### F014: commands/al.md 硬编码路径 + 标题修复 — done

**为什么必须修**：skill 里 fixer 和 deep-analyzer 示例用 `~/Projects` 硬编码，AI 照搬就跳过配置。

#### Steps
- [x] S1: 示例命令改用 `$PROJECTS_ROOT` 或 `<your-project-dir>` 占位符 ← verify: `grep '~/Projects' commands/al.md` 返回空

**改法**：
- `commands/al.md:123`：`--project-dir ~/Projects` → `--project-dir "$PROJECTS_ROOT"`
- `commands/al.md:173`：`--project-dir ~/Projects/my-project` → `--project-dir <your-project-dir>`

---

### F015: 更新 docs/ 到当前状态 — done

**为什么必须修**：checks.md 只记录 20 个 check（实际 31 个），scoring.md 权重全错，Safety 维度完全缺失。一个卖"evidence-backed"的工具自己文档错了，说不过去。

#### Steps
- [x] S1: 更新 `docs/checks.md` — 补全 F7, I7, W5, W6, C5, S1-S6 共 11 个 check 的描述 ← verify: `grep -c '^\| [A-Z][0-9]' docs/checks.md` 返回 31（checks.md 用表格格式，每行以 `| F1` / `| S3` 等开头）

**数据来源**：从 `src/scanner.sh` 中 grep 每个 check 的 `emit_result` 调用，提取 check ID 和描述。从 `standards/evidence.json` 提取 evidence 引用。

- [x] S2: 更新 `docs/scoring.md` — 修正维度权重，补全新 check 权重表（depends: S1）← verify: `grep 'Safety' docs/scoring.md` 有匹配；`node -e "const w=require('./standards/weights.json'); const d=w.dimensions; console.log(Object.entries(d).map(([k,v])=>k+':'+v.weight).join(','))"` 的输出和 scoring.md 中列出的权重一致

---

### F016: 清理杂项 — done

#### Steps
- [x] S1: `test-html-report.js` — fixture 创建失败时确保 cleanup 执行（用 `process.on('exit', ...)` 注册 cleanup）← verify: 读代码确认 cleanup 在 exit event 注册
- [x] S2: `docs/exec-plans/active/` 里旧计划中的 `harness-health` 引用 → `AgentLint` ← verify: `grep -ri 'harness.health' docs/` 返回空

---

## 执行顺序

```
批次 1 — P1 安全 + Critical（顺序执行，F001 必须先于 F005）
  F002 (Actions) ─┐
  F003 (命令名)  ─┤ 可并行
  F004 (F5 映射) ─┘
  F001 (RCE) ← 单独做，因为改 scanner.sh

批次 2 — Critical 基础设施（depends: F001 完成）
  F005 (set -euo pipefail) ← 必须在 F001 之后，因为两者都改 scanner.sh
  F006 (CI 覆盖)  ← 可和 F005 并行

批次 3 — P2 安全
  F007 (路径遍历) ─┐
  F008 (文件探测) ─┤ 可并行
  F009 (XSS)     ─┘

批次 4 — P3 + 文档 + 杂项（可并行，无依赖）
  F010 (bump-version) ─┐
  F011 (SECURITY.md)  ─┤
  F012 (glob 转义)    ─┤ 可并行
  F014 (al.md 路径)   ─┤
  F015 (docs 更新)    ─┘
  F016 (杂项) ← 最后做
```

## Constraints

- 所有改动走 PR，不直接 push main
- 开 `fix/security-hardening` 分支做
- 每个 Feature 完成后跑全套测试：`bash tests/test-scanner.sh && node tests/test-scorer.js && node tests/test-plan-generator.js && node tests/test-reporter.js && node tests/test-fixer.js`
- F001 是最大风险 step — 静态分析替代执行需要验证不降低 W6 检查的有效性
- F005 是最大工作量 step — scanner.sh 1282 行逐个排查合法非零退出
- **F001 和 F005 都改 scanner.sh，不能并行**。F001 先合并，F005 基于 F001 的结果做。

## Decision Log

- 2026-04-04: W6 选择静态分析而不是沙箱执行 — 原因：沙箱（Docker/nsjail）增加运行时依赖，AgentLint 的卖点是零依赖。静态分析足够判断 hook 是否包含慢命令。已知局限：`npm run` 间接调用不会被检测（后续迭代）。
- 2026-04-04: `pull_request_target` → `pull_request` — semantic PR lint action 在 `pull_request` 下完全一样能工作，不需要 secrets 或 write 权限。
- 2026-04-04: test-session-analyzer 和 test-deep-analyzer 加 skip guard 而不是加入 CI required — 它们依赖本地 corpus，CI 没有这个数据。
- 2026-04-04: F005 放批次 2 — `set -e` 对 scanner.sh 的影响面大，需要在 F001 修改 W6 后才能做，否则对已删除代码做守护是浪费。
- 2026-04-04: `scripts/committer` 保留不动 — 已有正确的 shebang + `set -euo pipefail` + shellcheck disable。不在 CI 里是因为它是开发者工具不是产品代码。从 F016 移除。
- 2026-04-04: F013（session-analyzer 隐私文档）合并进 F011（SECURITY.md 更新），减少小 feature 数量。
- 2026-04-04: 审稿修复 — F003 扩展为同时修 hooks.json 和 al.md（al.md:6 标题也是 `/hh`）；F004 S3 verify 从 `grep -n` 改为 `grep -rn`（目录需递归）；F005 S2 verify 从 `tests/*.sh` 改为递归搜索 `tests/ --include='*.sh'`；F010 明确包含 line 13 注入；F015 S1 verify 从 `^### ` 改为 `^\| [A-Z][0-9]`（匹配表格行不是标题）。

## Open Questions

- W6 静态分析的准确度：只检查已知慢命令列表够不够？是否需要额外规则（如 `npm run` → 查 package.json scripts）？**建议**：先做最简版（硬编码慢命令列表），发布后收集用户反馈再迭代。
