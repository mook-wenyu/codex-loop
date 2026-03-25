# 语言无关完成审查循环重构设计

日期：2026-03-25

## 背景

旧版 `codex-loop` 把收口建立在“完成协议 + 外置 verifier”上，并进一步扩展到了按仓类型自动发现 verifier。这个方向带来了三个结构性问题：

1. 与编程语言、构建系统和测试工具链耦合过深  
   Node、Gradle、PowerShell、未来的 Python / Rust / Go 都会不断把产品拖向“发现器工厂”。

2. 产品核心被外部验证稀释  
   用户真正需要的是“稳定长循环”和“可靠续跑”，不是一套越来越重的多语言测试编排器。

3. 无 verifier 时仍然存在收口设计矛盾  
   即便默认策略改成 fail-closed，也只是把问题从“过早结束”换成“无限续跑”；本质上仍在错误层面建模。

## 新目标

把 `codex-loop` 收缩成一个语言无关的最小内核：

- 只解决长程任务的持续推进与恢复
- 不依赖外置验证命令
- 不绑定任何语言或构建系统
- 通过两阶段完成审查降低“模型第一次说完成就退出”的风险

## 第一性原理

没有外部 verifier 时，系统不可能得到真正客观的外部正确性证明。

因此这里真正应该优化的不是“假装已验证”，而是：

1. 让会话连续  
   同一任务必须优先恢复同一 session。

2. 让目标连续  
   每轮都重新锚定原始用户请求，防止任务漂移。

3. 让收口稳定  
   第一次完成声明绝不能直接结束；必须插入一次强制反身审查。

## 核心设计

### 1. 删除外置验证子系统

删除：

- `--verify-cmd`
- `--verification-policy`
- 外置 verifier 执行器
- 仓类型自动发现器
- verification history / verification status 状态模型

保留：

- Goal Contract
- Goal Ledger
- Completion Protocol
- session 恢复
- `state-dir` 显式落盘

### 2. 引入两阶段完成审查

新的停止条件：

1. 第一次命中完成协议  
   不停止，改为进入 `completion-review-required`

2. 续跑同一会话并强制 fresh audit  
   必须重新检查：
   - 原始请求
   - 当前仓库状态
   - Goal Ledger

3. 只有完成审查后再次命中完成协议，才真正停止

### 3. 最小状态建模

状态只保留：

- `sessionId`
- `attemptCount`
- `goalLedger`
- `failureKind`
- `completedAt`

其中 `failureKind = completion-review-required` 既是下一轮提示的驱动信号，也是中断恢复后的审查状态恢复点。

### 4. Prompt 契约

Prompt 中显式写入：

- 原始请求始终是权威目标
- 第一次完成声明不会被接受
- 若进入完成审查轮次，必须 fresh audit
- 若仍有任何未完成或不确定项，继续工作，不得再次宣称完成

## 为什么这比旧方案更好

### 更简单

删除了所有外置验证发现、执行、策略分支，CLI 和状态模型显著瘦身。

### 更稳

旧方案的主要失效模式是：

- 没有 verifier 时直接软完成
- 或为了解决软完成而改成无限续跑

新方案把问题转成稳定的两阶段收口，避免在“有无 verifier”上来回摆动。

### 更通用

不需要知道项目是：

- Node
- Android / Gradle
- Python
- Rust
- Go
- 文档仓

只要是可持续推进的多阶段任务，都能用同一套循环内核。

## 风险与边界

### 已解决

- 直接因为一次轻率完成声明而结束
- 因为仓类型不同而需要不断扩展 verifier 发现器
- 长任务中目标逐轮收缩

### 未解决

- 没有外部 verifier 时的外部客观正确性证明

这不是本轮产品目标。当前版本解决的是“语言无关的稳定收口”，不是“机器可判定的外部正确性证明”。

## 测试策略

必须覆盖：

1. 首次命中完成协议不会退出
2. 审查轮次再次命中完成协议才会退出
3. 审查轮次中如果发现未完成项，状态会回到普通续跑
4. 中断恢复后仍能继续完成审查
5. CLI 不再暴露 verifier 相关参数
6. `state.json` 不再保留 verification 字段

## 参考资料

- OpenAI Codex CLI Reference  
  https://developers.openai.com/codex/cli/reference

- OpenAI: Unrolling the Codex agent loop  
  https://openai.com/index/unrolling-the-codex-agent-loop/

- OpenAI Evaluation Best Practices  
  https://platform.openai.com/docs/guides/evaluation-best-practices

- leo-lilinxiao/codex-autoresearch  
  https://github.com/leo-lilinxiao/codex-autoresearch

- Agentic Rubrics as Contextual Verifiers for SWE Agents  
  https://arxiv.org/abs/2601.04171

- ReVeal: Self-Evolving Code Agents via Iterative Generation-Verification  
  https://arxiv.org/abs/2506.11442
