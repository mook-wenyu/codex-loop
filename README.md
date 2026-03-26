# codex-loop

一个面向多阶段长程任务的 Codex 守护 CLI。

`codex-loop` 围绕 `codex exec` 和 `codex exec resume` 工作，目标很单一：

- 给定一个最终目标
- 持久化同一任务的会话与状态
- 在任务未真正收口前持续 `resume`
- 避免因为单轮自然结束、超时、阶段性总结，或一次轻率的“我做完了”就直接停下

当前版本刻意做了收缩：

- 不再依赖外置验证命令
- 不再绑定任何编程语言或构建系统
- 不再尝试自动发现仓库级测试/构建命令
- 只保留语言无关、最小但稳定的长循环内核

## 设计原则

从第一性原理看，这个工具真正需要解决的不是“怎么跑测试”，而是下面三个问题：

1. 会话连续性  
   多轮长任务不能每次都新开会话，必须优先恢复同一 `sessionId`。

2. 目标连续性  
   模型容易把最近一步误当成最终目标，必须持续把原始请求重新锚定回来。

3. 收口稳定性  
   没有外部 verifier 时，最危险的不是“跑不完”，而是“模型第一次说完成就结束”。  
   当前版本用“两阶段完成审查”解决这个问题。

## 当前运行模型

```text
最终目标
  -> initial
  -> 未完成 / 执行失败
  -> resume 同一会话
  -> 首次命中完成协议
  -> 强制进入完成审查轮次
  -> 再次命中完成协议
  -> 停止
```

关键点只有四条：

1. 同一个 `state-dir` 一旦有历史尝试，下一次启动只会 `resume`，不会重新开新会话。
2. 第一次命中完成协议不会立即结束，必须再跑一轮“新鲜审查”。
3. 只有“完成审查后再次命中完成协议”才真正结束。
4. 所有关键状态都显式写入 `state-dir`，中断后可以继续。

## 实时进度显示

当前版本会默认输出 CLI 进度，但刻意不展示伪精确百分比。

原因很直接：

1. `codex-loop` 能确定“当前处于哪一轮、哪个阶段”，但**不能真实知道** Codex 内部还剩多少推理步骤。
2. 对这种长程 agent 任务，伪造 `37% -> 52% -> 81%` 这类进度条会制造错误预期，反而降低可观测性。
3. 真正有价值的反馈是：**进程还活着、现在在哪个阶段、最近有没有事件、下一步会发生什么**。

因此当前实现采用“阶段进度 + 实时状态”的模型：

- 在 TTY 终端中：
  - 通过 `stderr` 显示单行实时状态
  - 展示当前轮次、`initial/resume` 模式、累计耗时、最近事件类型、短 session id
  - 在等待下一轮续跑时显示倒计时
- 在非 TTY 环境中：
  - 自动退化为普通日志行
  - 适合 CI、管道、文件重定向，不会输出一堆 ANSI 控制字符

你现在能看到的不是“假的完成百分比”，而是更可靠的执行面信号：

- `状态目录`
- `工作目录`
- `第 N 轮开始/结束`
- `进入完成审查轮次`
- `等待 X 秒后继续续跑`
- `任务完成：共执行 N 轮`

## 两阶段完成审查

当前版本不再使用外置 verifier，而是要求模型通过两段式收口：

### 第一阶段：完成申请

当模型认为任务已经全部完成时，可以使用完成协议。

这时守护器不会立即停止，而是记录：

- 本轮命中了完成协议
- 下一轮必须做一次新鲜审查

### 第二阶段：完成审查

守护器自动 `resume` 同一会话，并明确告诉模型：

- 不要相信上一轮自己的“已完成”结论
- 重新核对原始请求
- 重新核对当前仓库状态
- 重新核对 Goal Ledger
- 如果还有任何未完成或不确定项，继续工作，不得再次宣称完成

只有这轮审查后仍然再次命中完成协议，守护器才真正结束。

这个机制不需要知道仓库是 Node、Python、Rust、Go 还是 Android，因此天然语言无关。

## Goal Contract 与 Goal Ledger

为了降低任务漂移，`codex-loop` 保留两层长期记忆：

### Goal Contract

不可变的原始目标契约，包含：

- 原始 prompt
- `Prompt SHA-256`

每轮续跑都会重新注入，防止模型把目标缩窄成“只把刚才那一步做完”。

### Goal Ledger

从模型输出中提取的结构化工作记忆，包含：

- 已完成项
- 未完成项
- 阻塞项
- 证据摘要

它不是权威目标，只是续跑时的派生工作记忆。  
真正的权威始终是原始用户请求。

## 前置要求

- Node.js `>= 24`
- 已安装并可直接调用 `codex`
- 已完成 Codex 登录与配置
- 建议在 Git 仓库目录内运行，或显式接受 `--skip-git-repo-check`

关于 Codex 官方环境：

- OpenAI 官方文档目前仍将 Windows 标为实验性支持，最佳体验仍然更偏向 macOS / Linux / WSL。
- Codex CLI 默认读取 `~/.codex/config.toml`。
- `codex-loop` 默认不会显式传 `--config`，而是沿用 Codex CLI 的默认配置解析逻辑。

## 安装

当前仓库尚未发布到 npm registry，推荐直接按源码方式使用：

```bash
npm install
npm run build
```

如果希望暴露成全局命令：

```bash
npm link
codex-loop --help
```

也可以直接运行构建产物：

```bash
node dist/cli.js --help
```

如果需要查看给上游智能体使用的提示词生成协议：

```bash
codex-loop -ai
node dist/cli.js -ai
```

## 快速开始

### 1. 写最终目标，不要只写阶段目标

例如：

```md
检查当前仓库，补齐缺失测试，修复失败项，更新 README，并在确认全部完成后再结束。
```

### 2. 显式指定 `--state-dir`

如果你在乎中断恢复，请始终显式指定 `--state-dir`：

```bash
node dist/cli.js ./prompt.md \
  --workdir /path/to/repo \
  --state-dir .codex-loop-runs/my-task
```

### 3. 支持三种输入方式

文件输入：

```bash
node dist/cli.js ./prompt.md \
  --workdir /path/to/repo \
  --state-dir .codex-loop-runs/refactor-tests
```

直接文本：

```bash
node dist/cli.js \
  --prompt-text "检查仓库并持续推进，直到真正完成后再结束。" \
  --workdir /path/to/repo \
  --state-dir .codex-loop-runs/todo-fix
```

标准输入：

```bash
cat ./prompt.md | node dist/cli.js - \
  --workdir /path/to/repo \
  --state-dir .codex-loop-runs/stdin-task
```

PowerShell：

```powershell
Get-Content ./prompt.md | node dist/cli.js - `
  --workdir D:\path\to\repo `
  --state-dir .codex-loop-runs\stdin-task
```

## 给智能体使用

如果你的工作流是“智能体负责生成 prompt，人类手动执行 CLI”，请使用：

```bash
codex-loop -ai
```

这会输出一份给智能体看的提示词生成协议。协议的目标不是让智能体代替人执行 `codex-loop`，而是让它：

1. 先检索仓库上下文
2. 生成一份面向最终结果的 prompt 正文
3. 明确范围、约束、验收标准和交付要求
4. 把 prompt 交给人类，由人类手动执行 CLI

推荐的人类执行方式有两种：

直接粘贴：

```bash
codex-loop --prompt-text "<智能体生成的 prompt 正文>" \
  --workdir /path/to/repo \
  --state-dir .codex-loop-runs/my-task
```

先落文件再执行：

```bash
codex-loop ./prompt.md \
  --workdir /path/to/repo \
  --state-dir .codex-loop-runs/my-task
```

这样做的原因很直接：

- `codex-loop` 负责长循环执行与收口稳定性
- 上游智能体负责检索上下文并生成高质量 prompt
- 人类保留最终执行权，避免把执行策略、进度呈现和终端控制耦进上游智能体

## 常用选项

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `<prompt-file>` / `-` | 无 | prompt 文件路径，或 `-` 表示从 stdin 读取 |
| `--prompt-text <text>` | 无 | 直接传入原始最终目标，与文件输入互斥 |
| `--workdir <path>` | 当前目录 | Codex 实际工作的仓库目录 |
| `--state-dir <path>` | 自动创建临时目录 | 状态目录；想要可靠恢复时建议显式指定 |
| `--interval-seconds <number>` | `3` | 未完成时下一轮恢复前的等待秒数 |
| `--max-attempts <number>` | 无 | 限制最大尝试次数，适合 CI 或调试 |
| `--codex-bin <name>` | `codex` | Codex 可执行文件名 |
| `--model <name>` | 无 | 透传给 Codex 的模型参数 |
| `--confirm-text <text>` | `CONFIRMED: all tasks completed` | 自定义完成协议第二行文本 |
| `--resume-text-base <text>` | 内置默认文案 | 自定义续跑提示前缀 |
| `--full-auto` | 关闭 | 透传给 Codex 的 `--full-auto` |
| `--dangerously-bypass` | 开启 | 透传危险绕过模式 |
| `--skip-git-repo-check` | 开启 | 允许在非 Git 目录运行 |
| `-ai` / `--ai-help` | 无 | 输出给智能体看的提示词生成协议 |

## 环境变量

前缀统一为 `CODEX_LOOP_`，常用变量包括：

- `CODEX_LOOP_PROMPT_TEXT`
- `CODEX_LOOP_WORKDIR`
- `CODEX_LOOP_STATE_DIR`
- `CODEX_LOOP_INTERVAL_SECONDS`
- `CODEX_LOOP_MAX_ATTEMPTS`
- `CODEX_LOOP_CODEX_BIN`
- `CODEX_LOOP_MODEL`
- `CODEX_LOOP_CONFIRM_TEXT`
- `CODEX_LOOP_RESUME_TEXT_BASE`
- `CODEX_LOOP_FULL_AUTO`
- `CODEX_LOOP_DANGEROUSLY_BYPASS`
- `CODEX_LOOP_SKIP_GIT_REPO_CHECK`

命令行参数优先级高于环境变量。

## 恢复与并发

### 中断后怎么继续

最稳妥的做法是用同一个：

- `prompt`
- `workdir`
- `state-dir`

重新启动：

```bash
node dist/cli.js ./prompt.md \
  --workdir /path/to/repo \
  --state-dir .codex-loop-runs/my-task
```

如果 `state-dir` 中已有历史尝试：

- 优先使用持久化的 `sessionId`
- 拿不到 `sessionId` 时退回 `codex exec resume --last`

### 可以并发跑多个任务吗

可以，但必须满足：

- 一个任务一个独立 `state-dir`
- 不要让两个进程同时写同一个 `state-dir`
- 如果多个任务会改同一仓库，最好给每个任务独立 worktree

## 状态目录结构

```text
state-dir/
  state.json
  events.jsonl
  runner.log
  original-prompt.txt
  last-message.txt
  initial-prompt.txt
  resume-prompt.txt
  attempts/
    attempt-0001.last.txt
    attempt-0002.last.txt
```

最常用的文件：

- `state.json`：结构化任务状态、会话信息、Goal Ledger、失败上下文
- `runner.log`：守护器日志与 Codex stderr
- `events.jsonl`：Codex `--json` 事件流归档
- `last-message.txt`：最近一轮 assistant 的最终消息
- `original-prompt.txt`：原始最终目标
- `resume-prompt.txt`：最近一次续跑时发给 Codex 的 prompt

## 当前已知限制

- 没有外置 verifier，就不可能获得真正意义上的机器外部证明；当前版本解决的是“收口稳定性”，不是“外部客观正确性证明”。
- 如果首轮 `initial` 还没返回就被外部硬杀，当前版本仍不能完全保证恢复到同一个上游 `exec` 会话。
- Windows 上游 Codex CLI 仍是实验性支持，生产使用更建议 WSL。

## 开发与测试

```bash
npm test
npm run typecheck
npm run build
```

仓库内包含一个可控的 fake Codex 集成测试夹具，用于验证：

- `initial / resume / --last`
- 中断恢复
- 两阶段完成审查
- Goal Ledger 注入

## 参考资料

- [OpenAI Codex CLI 命令参考](https://developers.openai.com/codex/cli/reference)
- [OpenAI Prompt engineering 指南](https://platform.openai.com/docs/guides/prompt-engineering)
- [Anthropic Prompting best practices](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [OpenAI：Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
- [OpenAI Evaluation Best Practices](https://platform.openai.com/docs/guides/evaluation-best-practices)
- [leo-lilinxiao/codex-autoresearch](https://github.com/leo-lilinxiao/codex-autoresearch)
- [AutoPDL: Automatic Prompt Optimization for LLM Agents](https://arxiv.org/abs/2504.04365)
- [A Survey of Automatic Prompt Engineering: An Optimization Perspective](https://arxiv.org/abs/2502.11560)
- [Agentic Rubrics as Contextual Verifiers for SWE Agents](https://arxiv.org/abs/2601.04171)
- [ReVeal: Self-Evolving Code Agents via Iterative Generation-Verification](https://arxiv.org/abs/2506.11442)

## 许可证

MIT
