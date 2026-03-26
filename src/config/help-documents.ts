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
  '  -ai, --ai-help                输出给智能体看的提示词生成协议',
  '  -h, --help                    显示帮助',
  '  -V, --version                 显示版本'
] as const;

const AI_HELP_SECTIONS: readonly HelpSection[] = [
  {
    title: '面向智能体的提示词生成协议',
    lines: [
      `${CLI_NAME} 是一个长循环执行器，不是提示词生成器。`,
      '你的职责是先检索仓库上下文，再为人类生成一份高质量、可直接喂给 codex-loop 的最终目标 prompt。',
      '你只生成 prompt，不负责执行命令，不负责启动 codex-loop，也不负责接管终端会话。'
    ]
  },
  {
    title: '必须遵守',
    lines: [
      '1. 先检索仓库上下文：优先读取 AGENTS.md、README、package.json、src、test、docs，以及与当前任务直接相关的实现和测试文件。',
      '2. 从用户诉求提炼最终状态契约：写清最终目标、允许修改范围、硬性约束、验收标准、交付要求。',
      '3. 只生成 prompt：输出内容应服务于人类后续手动执行 CLI，不要执行 codex-loop。',
      '4. prompt 应面向最终结果，不要把阶段性分析、寒暄、元解释混进正文。',
      '5. prompt 应尽量可直接用于 --prompt-text，避免要求人类再次手写或重组。'
    ]
  },
  {
    title: 'prompt 必须包含',
    lines: [
      '- 最终目标：任务真正完成时仓库应达到什么状态。',
      '- 变更范围：允许修改哪些模块、文档、测试、脚本；不应扩散到哪些区域。',
      '- 约束条件：遵循 AGENTS.md、既有架构原则、测试要求、联网检索要求、语言与编码规范。',
      '- 验收标准：明确需要通过的测试、构建、类型检查、文档同步或人工核对项。',
      '- 交付要求：完成后需要汇报什么，例如修改摘要、验证结果、剩余风险。'
    ]
  },
  {
    title: 'prompt 不要包含',
    lines: [
      '- 不要把 resume、完成审查、循环控制、状态目录恢复逻辑写进 prompt；这些由 codex-loop 负责。',
      '- 不要输出“我现在就去执行 codex-loop”之类的动作承诺。',
      '- 不要让人类手写 prompt；你应该直接给出 prompt 正文。',
      '- 不要写兜底性模糊表述，例如“如果不确定就任选一个方案”；应给出明确边界。'
    ]
  },
  {
    title: '推荐输出格式',
    lines: [
      '建议给人类输出两部分：',
      '1. PROMPT_BODY：纯文本 prompt 正文，可直接复制给 --prompt-text 或保存为文件。',
      '2. MANUAL_RUN_EXAMPLE：一条示例命令，供人类手动执行 CLI。'
    ]
  },
  {
    title: '手动执行示例',
    lines: [
      '由人工手动执行 CLI，不要执行 codex-loop。',
      `${CLI_NAME} --prompt-text "<你生成的 prompt 正文>" --workdir <repo> --state-dir .codex-loop-runs/<task-name>`,
      '',
      '如果人类希望先落成文件：',
      `${CLI_NAME} ./prompt.md --workdir <repo> --state-dir .codex-loop-runs/<task-name>`
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
  return renderDocument(AI_HELP_SECTIONS);
}

function renderDocument(sections: readonly HelpSection[]): string {
  const lines: string[] = [];

  for (const [index, section] of sections.entries()) {
    if (index > 0) {
      lines.push('');
    }

    if (section.title !== undefined) {
      lines.push(`${section.title}：`);
    }

    lines.push(...section.lines);
  }

  return lines.join('\n');
}
