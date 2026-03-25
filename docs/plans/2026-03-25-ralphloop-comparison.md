# Ralphloop 对比分析与改进记录

> 目的：分析 Ralphloop / Ralph Wiggum Loop 对当前 `codex-loop` 的启发、边界与可落地改进。

## 1. 参考材料

本次分析参考了以下外部资料：

1. DeepSeek 分享页：<https://chat.deepseek.com/share/x7m865ep0dazxnmetv>
2. OpenCode Ralph Wiggum npm 页面：<https://www.npmjs.com/package/opencode-ralph-wiggum>
3. Pulumi 博客《Self-verifying AI agents … in the Ralph Wiggum Loop》：<https://www.pulumi.com/blog/self-verifying-ai-agents-vercels-agent-browser-in-the-ralph-wiggum-loop/>
4. Rust `ralphloop` crate 文档：<https://docs.rs/crate/ralphloop/0.1.0>
5. Vitest 官方文档：<https://vitest.dev/guide/test-context>
6. Node.js 官方文档：<https://nodejs.org/api/util.html>、<https://nodejs.org/api/child_process.html>

## 2. Ralphloop 的核心思想

从公开材料抽象后，Ralphloop 的本质不是某个具体命令，而是三层理念：

1. **循环驱动**：AI 不是单次执行，而是反复迭代直到外部条件满足
2. **完成在模型之外**：结束条件应由外部信号、验证器或环境状态决定，而不是只听模型说“我做完了”
3. **自验证闭环**：失败信息要反馈回下一轮，驱动代理继续修正

## 3. 当前项目已经吸收的部分

当前项目已经具备 Ralphloop 的一部分核心特征：

1. 有显式循环：`initial -> resume -> resume ...`
2. 有外部完成协议：靠严格两行协议而不是自然语言
3. 有状态持久化：`state.json`、事件流、最后消息、快照
4. 有防漂移能力：Goal Contract + 原始 prompt 全文 + `Prompt SHA-256`

## 4. Ralphloop 相对当前项目的优势

Ralphloop 风格方案的主要优势在于：

1. **更强调验证是闭环的一部分**。不是“做完后可选检查”，而是“检查失败就继续干”。
2. **更强调任务演化**。失败信息会被当成下一轮输入，而不是只做日志归档。
3. **更适合多阶段工作流**。公开材料显示其生态里有 JSON 工作流、多人/多工具协作和浏览器自验证等扩展。

## 5. 当前项目相对 Ralphloop 的优势

当前项目也有明显优势，而且这些优势是刻意保留的：

1. **更小、更聚焦**。只解决“Codex 长任务守护”这一件事，不引入完整工作流引擎。
2. **工程边界更清晰**。状态模型、Goal Contract、Fake Harness 和 CLI 分层都较薄，维护成本更低。
3. **更容易做确定性测试**。我们用 fake codex 最小协议夹具验证关键路径，而不是模拟整套 agent 平台。
4. **更贴近当前问题域**。Ralphloop 是泛化方法论；当前项目是针对 Codex CLI 的专用守护器。

## 6. 本轮落地的 Ralphloop 启发

本轮真正吸收并落地的启发有两项：

### 6.1 Goal Contract

把原始用户最终目标提升为不可变领域对象：

1. 保存原始 prompt 全文
2. 计算 `Prompt SHA-256`
3. 每一轮 `resume` 都重新附带原始目标

这解决的是 Ralphloop 风格“防止循环只盯着阶段目标”的问题。

### 6.2 Verifier 质量门

新增 `--verify-cmd`：

1. 模型命中完成协议后，不立即停止
2. 先运行外部 verifier
3. verifier 失败则把失败摘要反馈到下一轮 `resume`
4. 只有“完成协议 + verifier 通过”才算真正完成

这解决的是 Ralphloop 风格“完成在模型之外”的问题。

## 7. 为什么没有直接照抄 Ralphloop

当前项目不直接演化成 Ralphloop 式通用工作流引擎，原因是：

1. **YAGNI**：当前核心目标是可靠守护 Codex 长任务，不是做多代理编排平台
2. **复杂度成本高**：一旦引入 DAG、任务图、跨模型投票、多通道人工介入，维护成本会显著上升
3. **测试难度更高**：通用工作流引擎比专用守护器更难做确定性回归

## 8. 相对当前项目的不足

即使吸收了两项关键启发，当前项目仍有明显改进空间：

1. **verifier 仍是线性的**：现在只支持顺序外部命令，不支持依赖图或分阶段验证
2. **缺少 drift score**：现在是“哈希一致/不一致”二元判断，还没有连续漂移度量
3. **缺少失败分类**：还不能区分“环境失败”“验证失败”“模型理解失败”
4. **缺少恢复后的 verifier 反馈回放策略**：现在只保存最近一次验证结果，没有多轮验证历史摘要
5. **缺少策略化终止条件**：还没有“连续 N 次同类失败直接中止”等自保护规则

## 9. 下一步最值得做的改进

如果继续沿着 Ralphloop 启发推进，我建议优先级如下：

1. **Verification History**：把每次 verifier 结果结构化记录到 `state.json` 或独立日志
2. **Verifier Policy**：支持 `all-of` / `any-of` / staged verifier 组合
3. **Drift Scoring**：对 resume prompt 与 Goal Contract 做轻量漂移评分，而不只是哈希绑定
4. **Failure Taxonomy**：把失败分成协议、验证、环境、执行器四类，便于恢复和分析
5. **Checkpointed Feedback**：守护器异常退出后，恢复时自动附带最近 verifier 失败摘要

## 10. 结论

结论不是“当前项目应该变成 Ralphloop”，而是：

1. Ralphloop 提供了正确的高层启发：循环、自验证、完成外置
2. 当前项目的最优路线是**吸收这些原则**，而不是照搬成通用平台
3. 本轮已经落地了两项最值钱的启发：Goal Contract 与 Verifier Gate
4. 后续仍有改进余地，但应该继续遵循“小步、可测、可验证”的演进方式
