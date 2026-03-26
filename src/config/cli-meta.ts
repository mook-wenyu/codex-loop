import { readFile } from 'node:fs/promises';

import { CLI_NAME, ENV_PREFIX } from './product.js';

export function isHelpRequest(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export function isVersionRequest(argv: string[]): boolean {
  return argv.includes('--version') || argv.includes('-V');
}

export function renderHelpText(): string {
  return [
    `用法：${CLI_NAME} <prompt-file|-> [options]`,
    '',
    '说明：启动一次 codex exec，并在未严格完成前持续 resume 同一任务。',
    '默认在 TTY 的 stderr 上显示实时阶段进度；非 TTY 环境退化为普通日志行。',
    '',
    '选项：',
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
    '  -h, --help                    显示帮助',
    '  -V, --version                 显示版本',
    '',
    `环境变量前缀：${ENV_PREFIX}_*`
  ].join('\n');
}

export async function readPackageVersion(): Promise<string> {
  const packageJsonUrl = new URL('../../package.json', import.meta.url);
  const content = await readFile(packageJsonUrl, 'utf8');
  const packageJson = JSON.parse(content) as { version?: string };

  if (packageJson.version === undefined) {
    throw new Error('package.json 缺少 version 字段。');
  }

  return packageJson.version;
}
