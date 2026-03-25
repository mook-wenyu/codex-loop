# codex-loop 架构审查

> 状态：2026-03-25 已完成本轮审查，并据此落地项目更名与“第二次起强制 resume”硬约束
> 目标：从“只输入最终目标，其他过程尽可能无人值守并真实收口”的产品目标出发，识别当前架构的强项、边界与下一轮最值得投入的改进

## 0. 2026-03-25 实施回填

基于本文件与实施计划，本轮已经实际落地以下增强：

1. 已新增三态 `verificationPolicy`，支持 `required`、`auto` 与 `best-effort`，默认全局 `auto`
2. 已把“是否完成”和“是否已验证”分开建模：状态明确区分 `verified`、`unverified` 与 `failed`
3. 已堵住“缺少 verifier 时默认无限续跑”的活性缺口：默认 `auto` 在没有 verifier 时允许以 `unverified` 收口，而显式 `required` 仍会拒绝完成
4. 已把 `verificationHistory[]`、`failureKind` 和更清晰的恢复提示写入状态模型
5. 已新增最小 Goal Ledger，并让每轮 `resume` prompt 同时携带 Goal Contract 与 Goal Ledger
6. Rust / Go / Python / Make/Just 的自动 verifier 发现按本轮执行约束暂缓

## 1. 外部依据

本轮判断基于当前可核对的官方文档、工程资料和近期论文：

1. OpenAI Codex CLI 官方命令参考：`codex exec` 支持 `resume [SESSION_ID]` 和 `--last`，并继承 `~/.codex/config.toml` 默认配置。  
   <https://developers.openai.com/codex/cli/reference/>
2. Node.js `child_process` 官方文档：外部进程编排需要围绕异步子进程、PATH 查找和明确的退出码语义设计。  
   <https://nodejs.org/api/child_process.html>
3. Node.js `util.parseArgs` 官方文档：当前 CLI 复杂度足以用内置参数解析维持薄入口，不必过早引入更重框架。  
   <https://nodejs.org/api/util.html#utilparseargsconfig>
4. npm `package.json#bin` 官方文档：CLI 产品名与二进制命令名应该清晰且一致。  
   <https://docs.npmjs.com/cli/v11/configuring-npm/package-json>
5. Vitest 覆盖率官方文档：对于这种状态机式 CLI，单元测试 + fake E2E 的组合仍是性价比最高的验证方式。  
   <https://vitest.dev/guide/coverage.html>
6. RIVA（2026）：指出 agent 不能默认相信工具输出总是正确，验证历史和交叉校验会直接影响 drift detection 的可靠性。  
   <https://arxiv.org/abs/2603.02345>
7. SWE-CI（2026）：强调真正有价值的代理评估不是一次性静态答案，而是持续集成闭环中的长期可维护性与反复修正能力。  
   <https://arxiv.org/html/2603.03823v3>
8. SWE-Next（2026）：强调 `self-verifying instances` 和严格提交门的重要性，说明外部可执行验证对长程软件任务是核心信号。  
   <https://arxiv.org/pdf/2603.20691>

## 2. 产品定位结论

当前项目最准确的产品定义不是“研究代理”或“通用多 agent 平台”，而是：

> 一个围绕 Codex CLI 的恢复、验证和续跑循环器。

因此把项目名从 `codex-autoresearch` 收敛为 `codex-loop` 是正确的产品决策，原因有三点：

1. **语义更准**：核心能力是 loop，不是 research。
2. **边界更清楚**：避免误导成通用工作流引擎或研究框架。
3. **命令更短**：更适合作为真实 CLI 命令、脚本入口和自动化环境变量前缀。

## 3. 当前架构做对了什么

从第一性原理看，当前代码已经做对了几件关键事情：

1. **分层是清楚的**：CLI 解析、领域规则、状态存储、Codex 执行器、Verifier 都是分开的。
2. **完成判定是硬规则**：靠 Completion Protocol，而不是靠模型自然语言“我完成了”。
3. **目标锚定是显式的**：Goal Contract 保留原始 prompt 全文，并用 `Prompt SHA-256` 绑定 `stateDir`。
4. **恢复路径是确定的**：有 `state.json`、`events.jsonl`、`last-message.txt` 和 attempts 快照，便于重启和排障。
5. **测试策略是对的**：用 fake Codex 夹具覆盖 `exec / resume / --last`，比直接依赖真实联网 E2E 更稳定、更可维护。
6. **默认自动化方向正确**：默认危险模式 + 跳过 git 检查，符合“未上线、无存量用户、优先自动化”的产品约束。
7. **本轮新增的硬约束是对的**：同一 `stateDir` 有过历史尝试后，后续运行只允许 `resume`，不再允许重新 `initial`，这直接降低长程任务的上下文重复成本。

## 4. 当前离“真正无人值守”还差什么

当前项目已经能自动跑，但距离“只输入目标，其余都能稳定自动收口”还有几处明显短板。

### 4.1 最大问题：缺少 verifier 时的收口策略必须兼顾安全性与活性

该问题已在本轮通过三态 `verificationPolicy` 修复。

现在的行为是：

1. `required`：没有 verifier 时不允许完成
2. `auto`：默认策略；没有 verifier 时允许完成，但状态明确记为 `unverified`
3. `best-effort`：显式宽松模式；同样记为 `unverified`

这意味着：

1. 默认无人值守任务不会因为缺 verifier 而无限续跑。
2. 系统也不会再把“未验证完成”伪装成“验证通过”。
3. 对真正严格的任务，仍然可以显式切到 `required`。

结论：

> 对无人值守模式而言，“没有 verifier”不应该等价于“验证通过”；它应该等价于“允许收口，但必须明确标记为 unverified”。 

### 4.2 自动 verifier 发现范围太窄

当前只支持 Node 仓库的 `package.json scripts`，对 Rust、Go、Python、Makefile/justfile 仓库仍然没有自动发现能力。

这会直接导致：

1. 用户必须手工补 verifier，削弱“只输入目标”的自动化体验。
2. 很多非 Node 仓库会退化到 `source: none`。
3. 产品对真实多语言仓库的覆盖率不足。

### 4.3 验证结果只有最后一次，没有历史

该问题已在本轮修复：`state.json` 现在会同时保留 `lastVerification` 与 `verificationHistory[]`。

当前 `state.json` 只保留 `lastVerification`，没有完整验证历史。

后果是：

1. 重启后只知道“最后一次失败了”，不知道失败趋势和重复模式。
2. 无法做“连续 N 次同类失败停止并报错”的自保护策略。
3. 也无法在下一轮 resume 中构造更高质量的失败摘要。

### 4.4 失败没有类型学，恢复策略仍然太粗

该问题已在本轮部分修复：当前已经有 `failureKind`，并用于 runner log 与下一轮恢复提示；连续 N 次同类失败自动停机仍留待后续扩展。

当前非零退出、协议未命中、verifier 失败，本质上都被归到“继续下一轮”。

这会混淆四类完全不同的情况：

1. 执行器失败：例如 `codex` 命令异常或环境缺失
2. 模型理解失败：一直在跑偏，但没命中完成协议
3. 验证失败：命中协议了，但外部校验不过
4. 环境失败：依赖没装、网络有问题、仓库损坏

没有失败分类，就很难做精细的 backoff、终止、告警和恢复。

### 4.5 目标锚定目前还是“原始 prompt + 哈希”，还不是“可执行目标账本”

该问题已在本轮部分修复：现在已有最小 Goal Ledger，但仍然坚持原始 prompt 是唯一权威目标源。

当前 Goal Contract 的作用很重要，但它仍然只解决了“不要忘了原始目标”。

它还没解决的问题是：

1. 哪些已经完成，哪些还没完成，没有结构化账本。
2. 哪些结论是原始 prompt 直接要求的，哪些只是阶段性推断，没有证据分层。
3. 多轮长任务里，代理可能不断回到局部阶段目标，虽然没有彻底丢失最终目标，但会重复工作。

这也是现在“防止任务漂移”还没有彻底闭环的核心原因。

### 4.6 仓库锚定还不够强

当前只绑定了 `workdir` 和 `promptSha256`，但没有绑定仓库状态指纹。

潜在风险是：

1. 同一目录切换了分支或 HEAD，大任务仍可能继续旧会话。
2. 外部进程改动了工作树，守护器没有显式感知。
3. 对长周期任务来说，这会增加恢复时的语义偏差。

### 4.7 还缺少显式的停机与锁策略

当前没有状态目录文件锁，也没有“连续同类失败 N 次”的停机政策。

这意味着：

1. 同一 `stateDir` 被两个守护器同时使用时，状态可能互相污染。
2. 长时间卡在相同错误上时，只能靠 `maxAttempts` 这种比较粗的总次数上限。

## 5. 关于“外部验证”和“目标锚定”的当前约束

这是当前产品最关键的两条硬约束。

### 5.1 外部验证约束

当前系统按以下顺序决定 verifier：

1. 手工 `--verify-cmd`
2. 自动发现仓库 verifier
3. 若仍发现不到，则进入 `source: none`

这套机制现在更准确了：

1. `source: none` 不再等于“验证通过”
2. 默认 `auto` 会把任务标记为 `unverified` 后收口
3. 显式 `required` 才会因为缺 verifier 而拒绝完成

### 5.2 目标锚定约束

当前系统通过以下方式防漂移：

1. 原始用户 prompt 全文是唯一权威目标源
2. `Prompt SHA-256` 绑定 `stateDir`
3. 每轮 `resume` 都重新附带原始目标
4. 本轮新增“第二次起只能 resume”硬约束，避免重开新会话导致上下文重放和目标收缩

这套约束已经能明显降低漂移，但还没有形成“结构化完成账本”。

## 6. 下一轮最值得改什么

为了避免无限扩张，我建议下一轮只做四件事，而且按下面顺序推进。

### P1. 先把验证从二态改成三态，并把状态语义建模干净

已完成。

本轮已经落地：

1. `required`：发现不到 verifier 时直接不允许完成
2. `auto`：默认策略；有 verifier 时强约束，没有 verifier 时以 `unverified` 收口
3. `best-effort`：显式宽松模式；同样以 `unverified` 收口

结论更新为：  
对“无人值守模式”默认 `auto` 更合理；对“必须有确定性验证”的场景再显式切到 `required`。

### P2. 扩展多栈自动 verifier 发现

本轮按执行约束跳过，仍然是下一轮优先事项。

优先顺序建议：

1. Rust：`Cargo.toml` -> `cargo test`, `cargo build`, `cargo clippy`
2. Go：`go.mod` -> `go test ./...`, `go build ./...`
3. Python：`pyproject.toml` / `pytest.ini` -> `pytest`, `ruff`, `mypy`
4. `Makefile` / `justfile`：发现 `test` / `check` / `build`

这一步的价值在于减少“用户必须手写 verifier”的概率。

### P3. 记录 Verification History 和 Failure Taxonomy

已完成第一阶段落地：状态模型、历史落盘、失败分类与恢复提示都已接入。

建议把每轮验证和失败写成结构化历史，而不只保留最后一次：

1. `verificationHistory[]`
2. `failureKind`
3. `failureCountByKind`
4. `lastStableResumeTarget`

这样后续才能加：

1. 连续失败保护
2. 智能 backoff
3. 恢复时的高质量失败摘要

### P4. 把 Goal Contract 提升成 Goal Ledger

已完成最小实现：保留 Goal Contract 权威性，同时引入轻量 Goal Ledger。

不是去压缩用户目标，而是增加一个**引用原始 prompt 的结构化账本**：

1. 原始目标原文仍保持权威
2. Ledger 只记录已完成项、未完成项、验证证据、阻塞项
3. 每个条目都尽量引用原始 prompt 或 verifier 结果来源

这样可以减少长程任务中的阶段性回退和重复劳动。

## 7. 非目标

为了保持产品聚焦，以下方向当前都不建议做：

1. 不演化成 Ralphloop 式通用工作流引擎
2. 不做多代理 DAG 编排
3. 不做可视化编排器
4. 不为了“平台感”引入大量抽象层

当前最优路线仍然是：

> 继续把 `codex-loop` 打磨成一个单目标、强恢复、强验证、强约束的长程任务 harness。

## 8. 审查结论

一句话总结当前局势：

1. **产品方向是对的**
2. **恢复机制已经基本成型**
3. **真正的短板不在 loop，而在 verifier 和结构化目标管理**
4. **下一轮不要扩张，只补“验证 fail-open”“多栈发现”“历史与失败分类”“目标账本”这四块**
