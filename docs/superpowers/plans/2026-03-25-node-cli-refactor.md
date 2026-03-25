# Codex 长任务守护器 Node.js CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Bash 单文件脚本重构为跨平台、可测试、模块化的 TypeScript Node.js CLI。

**Architecture:** 采用 CLI 层 + 应用层 + 领域层 + 基础设施层的分层结构。核心业务规则集中在完成协议与状态恢复策略，子进程执行通过 `execa` 封装，所有关键策略均可脱离真实 `codex` 进程进行测试。

**Tech Stack:** Node.js 24、TypeScript、Vitest、execa、npm

---

### Task 1: 初始化工程骨架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [x] **Step 1: 写入工程配置文件**
- [x] **Step 2: 安装依赖**
- [x] **Step 3: 运行空测试命令，确认测试基线可执行**

### Task 2: 先写领域层失败测试

**Files:**
- Create: `test/unit/domain/completion-protocol.test.ts`
- Create: `test/unit/domain/session-id.test.ts`
- Create: `test/unit/application/options.test.ts`

- [x] **Step 1: 为完成协议生成与匹配写失败测试**
- [x] **Step 2: 为 session id 提取写失败测试**
- [x] **Step 3: 为 CLI 参数解析和校验写失败测试**
- [x] **Step 4: 运行对应测试，确认它们先失败**

### Task 3: 实现领域层与配置解析

**Files:**
- Create: `src/domain/completion-protocol.ts`
- Create: `src/domain/session-id.ts`
- Create: `src/config/options.ts`
- Create: `src/config/env.ts`

- [x] **Step 1: 实现完成协议领域对象**
- [x] **Step 2: 实现 session id 提取器**
- [x] **Step 3: 实现参数与环境变量解析**
- [x] **Step 4: 运行单元测试，确认由红转绿**

### Task 4: 先写应用层失败测试

**Files:**
- Create: `test/unit/application/supervisor.test.ts`
- Create: `test/unit/infrastructure/state-store.test.ts`

- [x] **Step 1: 为主循环首跑/续跑/完成停止写失败测试**
- [x] **Step 2: 为状态落盘和 prompt 摘要校验写失败测试**
- [x] **Step 3: 运行测试，确认先失败**

### Task 5: 实现状态存储与主循环

**Files:**
- Create: `src/application/supervisor.ts`
- Create: `src/application/types.ts`
- Create: `src/infrastructure/state/state-store.ts`
- Create: `src/infrastructure/filesystem.ts`

- [x] **Step 1: 实现结构化状态模型与文件布局**
- [x] **Step 2: 实现主循环与恢复策略**
- [x] **Step 3: 实现快照和元数据更新**
- [x] **Step 4: 运行应用层测试，确认通过**

### Task 6: 实现 Codex 子进程适配器与 CLI 入口

**Files:**
- Create: `src/infrastructure/codex/codex-executor.ts`
- Create: `src/cli.ts`
- Create: `src/index.ts`

- [x] **Step 1: 用 `execa` 实现跨平台 Codex 调用**
- [x] **Step 2: 连接 CLI 入口与应用服务**
- [x] **Step 3: 加入终止信号处理与退出码约定**
- [x] **Step 4: 为命令构建补充测试并跑绿**

### Task 7: 文档与仓库清理

**Files:**
- Modify: `README.md`
- Delete: `codex-keep-running.sh`

- [x] **Step 1: 更新 README 为 Node CLI 用法**
- [x] **Step 2: 删除旧 Bash 实现，消除双实现维护风险**
- [x] **Step 3: 校对文档与命令示例**

### Task 8: 全量验证与提交

**Files:**
- Modify: `package-lock.json`

- [x] **Step 1: 运行 `npm test`**
- [x] **Step 2: 运行 `npm run coverage`**
- [x] **Step 3: 运行 `npm run build`**
- [x] **Step 4: 运行 `npm run typecheck`**
- [x] **Step 5: 检查 `git diff` 与最终目录结构**
- [x] **Step 6: 使用中文提交所有变更**

### Task 9: 增加本地假 Codex 集成测试夹具

**Files:**
- Create: `test/fixtures/fake-codex/fake-codex.mjs`
- Create: `test/integration/support/fake-codex-harness.ts`
- Create: `test/integration/fake-codex.e2e.test.ts`
- Modify: `src/infrastructure/codex/codex-executor.ts`
- Modify: `src/cli-app.ts`

- [x] **Step 1: 先写失败的集成测试，覆盖 `exec`、`resume <sessionId>`、`resume --last`**
- [x] **Step 2: 实现最小 fake codex 协议脚本，只模拟守护器依赖的行为**
- [x] **Step 3: 通过 PATH 注入 fake codex，而不是显式覆盖真实 Codex 默认配置文件**
- [x] **Step 4: 为执行器补充环境注入点，使测试与生产默认行为解耦**
- [x] **Step 5: 重新运行全量测试、覆盖率、类型检查和构建**

### Task 10: 强化 Goal Contract、防漂移与自动化默认策略

**Files:**
- Create: `src/domain/goal-contract.ts`
- Modify: `src/cli-app.ts`
- Modify: `src/config/options.ts`
- Modify: `src/application/read-prompt.ts`
- Modify: `src/infrastructure/state/state-store.ts`
- Modify: `README.md`

- [x] **Step 1: 先写失败测试，覆盖 `--prompt-text`、Goal Contract 和默认危险自动化策略**
- [x] **Step 2: 实现 Goal Contract，把原始最终目标锚定到每轮 resume prompt**
- [x] **Step 3: 增加直接字符串输入，并与 prompt 文件输入做互斥校验**
- [x] **Step 4: 调整默认执行策略为危险模式 + 跳过 git 检查**
- [x] **Step 5: 同步状态目录与文档，记录原始 prompt 与目标锚定信息**

### Task 11: 提升 fake harness 为可复用 DSL

**Files:**
- Create: `test/integration/support/fake-codex-dsl.ts`
- Modify: `test/integration/support/fake-codex-harness.ts`
- Modify: `test/integration/fake-codex.e2e.test.ts`

- [x] **Step 1: 先写失败测试，覆盖 DSL 的可读场景定义**
- [x] **Step 2: 抽出 step builder、goal contract 断言与 response builder**
- [x] **Step 3: 补一条“非零退出但未完成时继续重试”的回归测试**
- [x] **Step 4: 重新跑全量验证并提交**

### Task 12: 吸收 Ralphloop 启发的 Verifier 质量门

**Files:**
- Create: `src/infrastructure/verifier/command-verifier.ts`
- Modify: `src/application/supervisor.ts`
- Modify: `src/application/types.ts`
- Modify: `src/config/options.ts`
- Modify: `src/cli-app.ts`
- Modify: `README.md`

- [x] **Step 1: 先写失败测试，覆盖 verifier 失败阻止完成与反馈注入**
- [x] **Step 2: 实现 `--verify-cmd` 与外部 verifier 抽象**
- [x] **Step 3: 让 verifier 失败摘要进入下一轮 `resume` prompt**
- [x] **Step 4: 更新设计文档与 Ralphloop 对比说明**
- [x] **Step 5: 重新跑全量验证并提交**

### Task 13: 默认自动发现 Verifier

**Files:**
- Create: `src/domain/verification-contract.ts`
- Create: `src/infrastructure/verifier/verification-planner.ts`
- Modify: `src/cli-app.ts`
- Modify: `test/integration/support/fake-codex-harness.ts`
- Modify: `README.md`

- [x] **Step 1: 先写失败测试，覆盖自动发现 Node verifier 与自动验证回归**
- [x] **Step 2: 实现 Verification Contract 与自动发现逻辑**
- [x] **Step 3: 让自动发现结果进入 prompt 和运行日志**
- [x] **Step 4: 更新 README 与设计文档，说明无需手工设置 verifier**
- [x] **Step 5: 重新跑全量验证并提交**

### Task 14: 项目更名为 codex-loop，并强化恢复会话硬约束

**Files:**
- Create: `src/config/product.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/config/options.ts`
- Modify: `src/config/cli-meta.ts`
- Modify: `src/cli-app.ts`
- Modify: `src/infrastructure/state/state-store.ts`
- Modify: `README.md`
- Modify: `docs/plans/2026-03-25-node-cli-design.md`
- Modify: `docs/plans/2026-03-25-ralphloop-comparison.md`
- Create: `docs/plans/2026-03-25-codex-loop-architecture-review.md`
- Create: `docs/superpowers/plans/2026-03-25-codex-loop-autonomy-hardening.md`
- Modify: `test/unit/application/options.test.ts`
- Modify: `test/unit/config/cli-meta.test.ts`
- Modify: `test/unit/infrastructure/state-store.test.ts`
- Modify: `test/unit/infrastructure/verification-planner.test.ts`
- Modify: `test/unit/application/read-prompt.test.ts`
- Modify: `test/integration/support/fake-codex-harness.ts`
- Modify: `test/integration/fake-codex.e2e.test.ts`

- [x] **Step 1: 收敛产品命名，把散落字符串抽成统一常量**
- [x] **Step 2: 完成包名、命令名、环境变量前缀和临时目录前缀的全仓替换**
- [x] **Step 3: 移除“第二次之后重新 initial”的逃生门，改为历史状态下强制 resume**
- [x] **Step 4: 增加“重启后仍然 resume --last”的回归测试**
- [x] **Step 5: 输出一版架构审查和下一轮最小闭环计划**
