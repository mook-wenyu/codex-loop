# Codex-loop 无人值守增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `codex-loop` 从“能自动续跑”推进到“只输入最终目标后，更可靠地无人值守自动收口”。

**Architecture:** 保持单一职责的专用 harness 路线，不引入通用工作流引擎。下一轮只补验证策略、多栈自动发现、结构化历史和更强的目标账本，不扩张到 DAG、多代理编排或平台化能力。

**Tech Stack:** Node.js 24、TypeScript 6、execa 9、Vitest 4

---

## 进度快照

- [x] 已完成项目更名为 `codex-loop`
- [x] 已统一命令名、环境变量前缀和临时状态目录前缀
- [x] 已移除“第二次之后仍可重新 initial”的逃生门，改为历史状态下强制 `resume`
- [x] 已实现三态验证策略化，默认切到 `auto`，并把收口状态区分为 `verified / unverified / failed`
- [ ] Rust / Go / Python / Make/Just 的自动 verifier 发现
  本轮按执行约束跳过，留待下一轮实现
- [x] 已实现 Verification History 与 Failure Taxonomy
- [x] 已实现 Goal Ledger，降低阶段目标回退和任务漂移

### Task 1: 验证策略化，堵住 fail-open

**Files:**
- Modify: `src/domain/verification-contract.ts`
- Modify: `src/infrastructure/verifier/verification-planner.ts`
- Modify: `src/application/supervisor.ts`
- Modify: `src/application/types.ts`
- Modify: `src/config/options.ts`
- Modify: `README.md`
- Test: `test/unit/infrastructure/verification-planner.test.ts`
- Test: `test/unit/application/supervisor.test.ts`
- Test: `test/integration/fake-codex.e2e.test.ts`

- [x] **Step 1: 先写失败测试，覆盖默认 `auto` 与显式 `required` 的缺 verifier 分支**
- [x] **Step 2: 增加 `verificationPolicy` 建模，支持 `required`、`auto` 与 `best-effort`**
- [x] **Step 3: 让无人值守默认策略切到 `auto`，并把 `verified / unverified / failed` 状态写入状态模型**
- [x] **Step 4: 运行受影响测试并确认失败摘要能进入下一轮 `resume`**

### Task 2: 多栈自动发现 Verifier

**Files:**
- Modify: `src/infrastructure/verifier/verification-planner.ts`
- Modify: `src/domain/verification-contract.ts`
- Modify: `README.md`
- Modify: `docs/plans/2026-03-25-codex-loop-architecture-review.md`
- Test: `test/unit/infrastructure/verification-planner.test.ts`
- Test: `test/integration/support/fake-codex-harness.ts`
- Test: `test/integration/fake-codex.e2e.test.ts`

- [ ] **Step 1: 先写失败测试，覆盖 Rust / Go / Python / Make/Just 的最小发现路径**
- [ ] **Step 2: 实现按仓库信号文件分支发现验证命令**
- [ ] **Step 3: 保持输出顺序稳定，避免相同仓库每次生成不同验证命令集合**
- [ ] **Step 4: 更新文档，明确当前自动发现支持矩阵**

### Task 3: Verification History 与 Failure Taxonomy

**Files:**
- Modify: `src/application/types.ts`
- Modify: `src/infrastructure/state/state-store.ts`
- Modify: `src/application/supervisor.ts`
- Modify: `README.md`
- Modify: `docs/plans/2026-03-25-codex-loop-architecture-review.md`
- Test: `test/unit/infrastructure/state-store.test.ts`
- Test: `test/unit/application/supervisor.test.ts`

- [x] **Step 1: 先写失败测试，覆盖多轮 verifier 失败历史落盘**
- [x] **Step 2: 为状态模型增加 `verificationHistory[]` 和 `failureKind`**
- [x] **Step 3: 按失败类型驱动更清晰的 runner log 与下一轮恢复提示**
- [x] **Step 4: 评估是否需要“连续 N 次同类失败停止”的最小保护规则**
  当前结论：本轮先不加入“连续 N 次同类失败即停机”，保留历史与失败类型作为下一轮扩展基础

### Task 4: Goal Ledger 与轻量防漂移增强

**Files:**
- Create: `src/domain/goal-ledger.ts`
- Modify: `src/domain/goal-contract.ts`
- Modify: `src/application/supervisor.ts`
- Modify: `src/infrastructure/state/state-store.ts`
- Modify: `README.md`
- Modify: `docs/plans/2026-03-25-codex-loop-architecture-review.md`
- Test: `test/unit/domain/goal-contract.test.ts`
- Test: `test/unit/application/supervisor.test.ts`
- Test: `test/integration/fake-codex.e2e.test.ts`

- [x] **Step 1: 先写失败测试，覆盖多轮任务中未完成事项的结构化保留**
- [x] **Step 2: 实现最小 Goal Ledger，只记录已完成项、未完成项、阻塞项和证据摘要**
- [x] **Step 3: 保持原始 prompt 仍是唯一权威目标源，不让 Ledger 反客为主**
- [x] **Step 4: 让 resume prompt 同时携带 Goal Contract 和最小 Ledger**

### Task 5: 全量验证与提交

**Files:**
- Modify: `package-lock.json`

- [x] **Step 1: 运行 `npm test`**
- [x] **Step 2: 运行 `npm run coverage`**
- [x] **Step 3: 运行 `npm run typecheck`**
- [x] **Step 4: 运行 `npm run build`**
- [x] **Step 5: 检查 `git diff`、文档状态和最终命令示例**
- [x] **Step 6: 使用中文提交所有变更**
