# Codex 长任务守护器 Node.js CLI 设计说明

> 状态：已确认并直接执行
> 背景：用户已明确要求直接推进实现，不走额外审批环节

## 1. 问题定义

当前仓库只有一个 Bash 脚本，核心价值是：

1. 启动一次 `codex exec`
2. 在未严格完成前持续执行 `codex exec resume`
3. 通过一次性完成协议，而不是自然语言，总结是否真正完成
4. 持久化状态，支持守护进程重启后继续追踪同一会话

原实现的主要问题：

1. 依赖 Bash，天然不跨平台，Windows 体验差
2. 逻辑集中在单文件脚本里，测试困难，模块边界弱
3. 状态以散落文本文件为主，结构化程度有限
4. 子进程调用细节与业务规则耦合，不利于演进和测试

## 2. 第一性原理分析

这个项目的本质不是“做一个 CLI 壳”，而是“可靠地编排一个外部代理进程”。

因此最重要的不是：

1. 参数解析有多花哨
2. 是否支持很多装饰性命令
3. 是否兼容旧 Bash 用法

最重要的是：

1. 子进程调用在 Windows、macOS、Linux 上都可预测
2. 完成判定严格、可测试、不会被自然语言误伤
3. 状态恢复显式、可追踪、不会悄悄接错任务
4. 核心策略可以脱离真实 `codex` 进程进行测试

## 3. 技术决策

### 3.1 运行时与语言

采用 Node.js 24 + TypeScript。

原因：

1. 当前环境已安装 Node `v24.13.1`
2. Node 官方已提供稳定的 CLI、文件系统、加密和计时能力
3. TypeScript 适合为“状态对象 + 命令构建 + 进程结果”提供强约束

### 3.2 CLI 解析

采用 Node 内置 `util.parseArgs`，不引入 Commander/Yargs。

原因：

1. 当前需求只有单一主命令，参数表并不复杂
2. 内置能力已经足够，减少不必要依赖
3. CLI 的复杂度不该盖过核心守护逻辑

### 3.3 子进程执行

采用 `execa`，不直接手写平台分支调用 `child_process.spawn`。

原因：

1. 本机实验已验证：Windows 下直接 `spawn('codex')` 会失败
2. 这个问题属于典型跨平台进程包装场景，优先复用成熟方案
3. `execa` 在流式输出、取消控制和错误语义上比原生 API 更适合当前任务

### 3.4 测试框架

采用 `Vitest`。

原因：

1. 当前最新版本支持 Node 20+
2. 对 TypeScript、假定时器、模块 mock 和覆盖率支持成熟
3. 适合把“完成协议、状态恢复、命令构建、主循环”拆成细粒度测试

## 4. 架构设计

### 4.1 模块边界

#### CLI 层

职责：

1. 解析参数与环境变量
2. 做输入校验
3. 组装依赖并启动应用服务
4. 处理退出码与终止信号

#### 应用层

职责：

1. 驱动首轮执行与续跑循环
2. 决定本轮是 `initial` 还是 `resume`
3. 记录尝试次数、退出码、状态更新时间
4. 在完成协议命中时终止循环

#### 领域层

职责：

1. 生成 `nonce` 与 `done token`
2. 构建完成协议文本
3. 精确判定最后消息是否满足“仅两行且完全匹配”
4. 计算 prompt 摘要，阻止不同任务误复用同一状态目录
5. 维护不可变的 Goal Contract，持续把原始用户最终目标锚定到每轮 resume

#### 基础设施层

职责：

1. 管理状态目录与文件落盘
2. 调用 `codex` CLI
3. 将 stdout/stderr 归档到事件与运行日志
4. 从本轮事件文本中提取 session id

### 4.2 状态模型

新实现改用结构化 `state.json`，替代旧的 `meta.env` + `session-id.txt` 分散模式。

建议字段：

1. `schemaVersion`
2. `workdir`
3. `stateDir`
4. `promptSha256`
5. `nonce`
6. `doneToken`
7. `confirmText`
8. `sessionId`
9. `attemptCount`
10. `createdAt`
11. `updatedAt`
12. `completedAt`
13. `lastExitCode`

### 4.3 状态目录布局

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

### 4.4 关键行为约束

1. 如果 `state.json` 已存在且 `promptSha256` 与当前 prompt 不一致，直接报错退出
2. 如果 `state.json` 标记已完成，直接报错退出，要求使用新状态目录
3. 如果能拿到 `sessionId`，优先按 id 恢复
4. 如果没有 `sessionId` 但存在历史状态，才允许回退到 `--last`
5. `codex` 可执行文件找不到属于致命错误，不允许静默重试
6. `codex` 子进程非零退出码默认视为“本轮未完成”，允许下一轮继续
7. 每轮 `resume` 都必须携带 Goal Contract，防止代理把阶段性输出误当成最终目标
8. 用户最终目标以原始 prompt 文本为准，不在运行中做语义改写或压缩总结
9. 若存在外部 verifier，则只有“完成协议 + verifier 通过”才算 `verified`
10. 若没有外部 verifier，则按 `verificationPolicy` 决定是拒绝收口还是以 `unverified` 状态完成
11. 同一 `stateDir` 一旦已有历史尝试，后续运行只能 `resume`，不允许重新 `initial`

## 5. 接口草案

```text
codex-loop <prompt-file|-> [options]
```

核心参数：

1. `--workdir <path>`
2. `--state-dir <path>`
3. `--interval-seconds <number>`
4. `--max-attempts <number>`
5. `--codex-bin <name>`
6. `--model <name>`
7. `--confirm-text <text>`
8. `--resume-text-base <text>`
9. `--full-auto`
10. `--dangerously-bypass`
11. `--skip-git-repo-check`

对应环境变量采用 `CODEX_LOOP_*` 前缀作为自动化入口。

新增直接文本输入：

1. `--prompt-text <text>` 允许直接以字符串提供原始用户请求
2. 与 `<prompt-file|->` 互斥，防止输入来源歧义

Goal Contract 设计：

1. 以原始用户 prompt 为唯一权威目标来源
2. 计算 `Prompt SHA-256` 作为状态绑定标识
3. 每一轮 `resume` 都重新附带原始用户请求全文
4. 不做语义摘要式“目标压缩”，避免二次解释带来的漂移

新增 verifier：

1. `--verify-cmd <command>` 可重复配置
2. 若未显式配置 verifier，则自动发现仓库级 verifier
3. verifier 只在完成协议命中后运行
4. verifier 失败摘要必须进入下一轮 `resume`

当前自动发现策略：

1. 优先显式 `--verify-cmd`
2. 否则自动发现 Node 仓库 `package.json scripts`
3. 当前 Node 自动发现顺序：`typecheck -> test -> build -> lint`

当前验证策略：

1. `required`：发现不到 verifier 时不允许完成
2. `auto`：默认策略；有 verifier 时强约束，没有 verifier 时以 `unverified` 状态完成
3. `best-effort`：显式宽松模式；同样以 `unverified` 状态完成

## 6. 测试策略

### 6.1 单元测试

覆盖：

1. 完成协议生成与匹配
2. prompt 摘要与状态一致性校验
3. 参数解析与校验
4. `codex` 命令构建
5. session id 提取

### 6.2 集成测试

覆盖：

1. 初次执行后进入续跑
2. 命中完成协议后停止
3. 可从状态目录恢复 session id
4. prompt 不一致时报错
5. `max-attempts` 到达后以明确退出码退出
6. 通过本地假 `Codex` 自动化验证 `exec`
7. 通过本地假 `Codex` 自动化验证 `resume <sessionId>`
8. 通过本地假 `Codex` 自动化验证 `resume --last`
9. 验证非零退出码但未完成时会继续重试
10. 验证 `--prompt-text` 直接输入
11. 验证每轮 resume 都附带 Goal Contract 以锚定最终目标
12. 验证 verifier 失败会阻止完成并驱动下一轮修复

### 6.3 本地假 Codex 夹具设计

为避免真实联网 E2E 带来的不稳定性，本项目新增“假 `Codex`”集成测试夹具。

夹具只模拟与守护器直接相关的最小协议：

1. 接收 `codex exec` / `codex exec resume`
2. 从标准输入读取 prompt
3. 向 stdout 输出 JSONL 事件
4. 按 `-o` 写入最后消息文件
5. 记录“最近会话”以支持 `--last`
6. 校验每一轮 prompt 是否仍然包含 Goal Contract

这套夹具的边界刻意保持很小，不去伪造真实 Codex 的全部行为。这样做的原因是：

1. 测试重点是守护器自己的会话编排与恢复策略
2. 夹具越小，越不容易引入第二套复杂逻辑
3. 当真实 Codex CLI 演化时，维护成本更低

### 6.4 默认配置文件策略

生产路径下，守护器**不显式传递** `--config`，也不强行改写 `CODEX_HOME`。

这意味着真实运行时继续沿用 Codex CLI 自己的默认配置解析逻辑。在当前机器上，默认配置文件路径是：

```text
C:\Users\WenYu\.codex\config.toml
```

测试路径下，为了注入假 `Codex` 可执行文件，只通过环境变量修改 `PATH`，不覆盖默认配置文件参数。

### 6.5 自动化默认策略

根据当前项目“未上线、无存量用户、以完全自动化为目标”的约束，CLI 默认策略调整为：

1. 默认启用 `--dangerously-bypass-approvals-and-sandbox`
2. 默认启用 `--skip-git-repo-check`
3. 默认不启用 `--full-auto`，因为在危险模式下它不再提供额外价值

这是一项明确的产品级取舍，不保留向旧 Bash 版本对齐的兼容层。

### 6.6 非目标

本轮不做：

1. 真实联网调用 Codex 的 E2E 自动测试
2. 多进程并发守护同一状态目录
3. 配置文件系统

## 7. 研究依据

### 官方文档与资料

1. Node.js `util.parseArgs` 官方文档：https://nodejs.org/api/util.html
2. Node.js `child_process` 官方文档：https://nodejs.org/api/child_process.html
3. npm `package.json` `bin` 字段官方文档：https://docs.npmjs.com/cli/v11/configuring-npm/package-json
4. TypeScript TSConfig 参考：https://www.typescriptlang.org/tsconfig/
5. Vitest 官方指南：https://vitest.dev/guide/
6. OpenAI Codex CLI 官方命令参考：https://developers.openai.com/codex/cli/reference/
7. Vitest Test Context 官方文档：https://vitest.dev/guide/test-context
8. 本地安装的 OpenAI Codex README：`%APPDATA%\npm\node_modules\@openai\codex\README.md`

### 论文与研究

1. 软件可维护性与演化相关综述（PMC 开放获取）：https://pmc.ncbi.nlm.nih.gov/articles/PMC7198249/
2. 依赖治理与供应链风险研究（用于约束依赖数量与复杂度）：https://arxiv.org/abs/2502.08943

## 8. 结论

推荐方案是：

1. 放弃 Bash 实现，不做兼容层
2. 以 TypeScript 重建为单一职责清晰的跨平台 CLI
3. 只引入真正解决跨平台痛点的依赖
4. 通过结构化状态模型与高覆盖率测试保证可维护性
5. 通过本地假 `Codex` 夹具补齐 `exec` / `resume` / `--last` 的自动化回归测试
6. 通过 Goal Contract 和 prompt 摘要共同抑制任务漂移
