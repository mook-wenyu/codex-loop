import { CLI_NAME, ENV_PREFIX } from './product.js';

interface HelpSection {
  readonly title?: string;
  readonly lines: readonly string[];
}

const HUMAN_OPTION_LINES = [
  '  --prompt-text <text>          直接传入原始任务文本，与 prompt 文件输入互斥',
  '  --workdir <path>              指定 Codex 实际工作的仓库目录',
  '  --state-dir <path>            指定状态目录；未提供时自动创建临时目录',
  '  --interval-seconds <number>   指定续跑间隔秒数，默认 3',
  '  --progress-format <mode>      进度输出格式：text（默认）或 json',
  '  --max-attempts <number>       限制最大尝试次数，适合 CI/测试场景',
  '  --codex-bin <name>            指定 Codex 可执行文件名，默认 codex',
  '  --model <name>                透传给 Codex 的模型参数',
  '  --confirm-text <text>         自定义完成协议第二行文本',
  '  --resume-text-base <text>     自定义续跑提示前缀',
  '  --full-auto                   启用 Codex 的 --full-auto',
  '  --no-full-auto                禁用 --full-auto',
  '  --dangerously-bypass          启用危险绕过模式（默认开启）',
  '  --no-dangerously-bypass       关闭危险绕过模式',
  '  --skip-git-repo-check         跳过 git 仓库检查（默认开启）',
  '  --no-skip-git-repo-check      关闭跳过 git 仓库检查',
  '  -ai, --ai-help                输出面向智能体的使用协议与可执行提示生成协议',
  '  -h, --help                    显示帮助',
  '  -V, --version                 显示版本'
] as const;

const AI_PROTOCOL_SECTIONS: readonly HelpSection[] = [
  {
    title: '面向智能体的使用协议（可执行提示生成协议）',
    lines: [
      `${CLI_NAME} 是 codex exec/resume 的长循环外壳。`,
      '你的职责不是手写阶段计划，也不是复述帮助文档，而是基于仓库上下文生成一份高质量、可直接执行的最终目标 prompt。',
      `${CLI_NAME} 已经负责：会话续跑、完成协议、完成后二次审查、状态落盘。`,
      '因此你生成 prompt 时，只需要定义任务目标与验收，不要重复实现 loop 机制。'
    ]
  },
  {
    title: '执行步骤',
    lines: [
      '1. 先检索仓库上下文：优先读取 AGENTS.md、README、package.json、src、test、docs，以及与当前任务直接相关的实现与测试文件。',
      '2. 从用户原始诉求提炼“最终状态契约”：写清最终结果、变更范围、硬性约束、验收标准、交付物。',
      '3. 只保留必要上下文：补充与任务强相关的模块、命令、架构约束，不要塞入无关文件摘要。',
      '4. 生成 prompt 本体：默认输出一段可直接传给 --prompt-text 的纯文本，不要附加解释、寒暄、Markdown 包装或多余前后缀。',
      '5. 如果上游系统在后台执行 codex-loop，优先同时指定 --progress-format json，让编排层稳定消费 JSONL 进度事件。',
      '6. 需要复用或审计时，再把同一份 prompt 落到文件；否则优先直接走 --prompt-text。'
    ]
  },
  {
    title: 'prompt 必须包含',
    lines: [
      '- 最终目标：任务真正完成时仓库应处于什么状态。',
      '- 作用范围：允许修改哪些模块、文档、测试、脚本；禁止扩散到哪些区域。',
      '- 约束条件：语言、编码规范、架构原则、是否允许重构、是否必须补测试、是否必须联网检索。',
      '- 验收标准：用什么证据证明完成，例如具体测试、类型检查、构建、文档同步。',
      '- 交付要求：最终回复需要说明什么，是否需要列出风险、验证结果、剩余技术债。'
    ]
  },
  {
    title: 'prompt 里不要写',
    lines: [
      '- 不要把续跑机制写进 prompt。',
      '- 不要把“如果未完成就继续 resume / 再跑一轮 / 进入完成审查”写进 prompt；这些由 codex-loop 负责。',
      '- 不要要求人工手写 prompt 文件；上游智能体应直接生成 prompt 文本。',
      '- 不要把模糊目标写成阶段待办清单，例如“先看看项目再说”“先分析一下”。',
      '- 不要加入兜底性模糊表述，例如“如果不确定就随便选择合理方案”；应尽量给出明确边界和验收。'
    ]
  },
  {
    title: '推荐输出模板',
    lines: [
      '下面模板中的占位内容应被替换为当前任务的真实信息；如果上游系统需要直接执行，只输出替换后的正文：',
      '',
      '[最终目标]',
      '把 <任务目标> 完成到可验收状态，而不是只停留在阶段性分析或部分修改。',
      '',
      '[仓库上下文]',
      '当前仓库与本任务直接相关的事实：',
      '- <相关模块/入口/脚本/测试>',
      '- <关键约束或架构事实>',
      '',
      '[变更范围]',
      '- 允许修改：<文件/模块范围>',
      '- 禁止扩散：<不应改动的区域>',
      '',
      '[硬性约束]',
      '- 遵循仓库内 AGENTS.md / README / 既有测试约束。',
      '- 保持高内聚、低耦合，优先做根因修复，不写掩盖 bug 的兜底逻辑。',
      '- 如果涉及行为变更，必须补充或更新自动化测试。',
      '',
      '[验收标准]',
      '- <必须通过的测试/检查>',
      '- <必须同步的文档或示例>',
      '- <完成时应满足的最终状态>',
      '',
      '[交付要求]',
      '完成后给出：修改摘要、为什么这么做、验证结果、剩余风险。'
    ]
  },
  {
    title: '调用方式',
    lines: [
      '优先直接把生成结果传给 --prompt-text：',
      `${CLI_NAME} --prompt-text "<AI 生成的 prompt>" --workdir <repo> --state-dir .codex-loop-runs/<task-name>`,
      '',
      '保留进度可视性：实时阶段进度默认输出到 stderr，最终 assistant 消息输出到 stdout。上游调用方不要吞掉 stderr。',
      '如果需要同时保留机器可消费结果和人类可见进度，应实时转发 stderr，并单独捕获 stdout 最终结果。',
      `如果上游是后台智能体或编排器，优先使用：${CLI_NAME} --progress-format json --prompt-text "<AI 生成的 prompt>" --workdir <repo> --state-dir .codex-loop-runs/<task-name>`,
      '',
      '如果需要落文件：',
      `${CLI_NAME} ./prompt.md --workdir <repo> --state-dir .codex-loop-runs/<task-name>`
    ]
  },
  {
    title: '最低质量门槛',
    lines: [
      '- 先检索仓库上下文，再写 prompt。',
      '- prompt 必须写清验收标准，避免只描述过程不描述完成状态。',
      '- prompt 应面向最终结果，而不是要求模型重复解释自己的计划。',
      '- 如果需要观察实时进度，上游系统必须保留 stderr；只读取 stdout 只会看到最终消息。',
      '- 后台执行时，优先使用 --progress-format json，而不是依赖解析自然语言进度文本。',
      '- 如果用户要求联网检索、对齐最新资料或引用权威来源，prompt 中必须明确保留该要求。'
    ]
  }
] as const;

export function renderHelpText(): string {
  return renderDocument([
    {
      lines: [`用法：${CLI_NAME} <prompt-file|-> [options]`]
    },
    {
      lines: [
        '说明：启动一次 codex exec，并在未严格完成前持续 resume 同一任务。',
        '默认在 TTY 的 stderr 上显示实时阶段进度；非 TTY 环境退化为普通日志行。'
      ]
    },
    {
      title: '选项',
      lines: HUMAN_OPTION_LINES
    },
    {
      lines: [`环境变量前缀：${ENV_PREFIX}_*`]
    }
  ]);
}

export function renderAiHelpText(): string {
  return renderDocument(AI_PROTOCOL_SECTIONS);
}

function renderDocument(sections: readonly HelpSection[]): string {
  const output: string[] = [];

  for (const [index, section] of sections.entries()) {
    if (index > 0) {
      output.push('');
    }

    if (section.title !== undefined) {
      output.push(`${section.title}：`);
    }

    output.push(...section.lines);
  }

  return output.join('\n');
}
