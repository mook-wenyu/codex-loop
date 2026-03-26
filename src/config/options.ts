import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { parseBooleanEnvValue } from './env.js';
import { envVarName } from './product.js';

const DEFAULT_CONFIRM_TEXT = 'CONFIRMED: all tasks completed';
const DEFAULT_RESUME_TEXT_BASE =
  'You must respond to this message. Continue any unfinished user-requested work immediately from the current state. Do not restart. Do not summarize. Do not ask for confirmation. If all requested work is already complete, follow the completion protocol below.';

export interface ParseCliOptionsInput {
  readonly argv: string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface CliOptions {
  readonly promptSource?: string;
  readonly promptText?: string;
  readonly workdir: string;
  readonly stateDir?: string;
  readonly intervalSeconds: number;
  readonly progressFormat: 'text' | 'json';
  readonly maxAttempts?: number;
  readonly codexBin: string;
  readonly model?: string;
  readonly confirmText: string;
  readonly resumeTextBase: string;
  readonly fullAuto: boolean;
  readonly dangerouslyBypass: boolean;
  readonly skipGitRepoCheck: boolean;
}

export function parseCliOptions(input: ParseCliOptionsInput): CliOptions {
  const readEnv = (name: string): string | undefined =>
    input.env[envVarName(name)];
  const parsed = parseArgs({
    args: input.argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      workdir: { type: 'string' },
      'state-dir': { type: 'string' },
      'prompt-text': { type: 'string' },
      'interval-seconds': { type: 'string' },
      'progress-format': { type: 'string' },
      'max-attempts': { type: 'string' },
      'codex-bin': { type: 'string' },
      model: { type: 'string' },
      'confirm-text': { type: 'string' },
      'resume-text-base': { type: 'string' },
      'full-auto': { type: 'boolean', default: undefined },
      'dangerously-bypass': { type: 'boolean', default: undefined },
      'skip-git-repo-check': { type: 'boolean', default: undefined }
    },
    strict: true
  });

  const promptSource = parsed.positionals[0];
  const promptText = parsed.values['prompt-text'] ?? readEnv('PROMPT_TEXT');

  if (promptSource !== undefined && promptText !== undefined) {
    throw new Error('promptSource 与 --prompt-text 互斥，只能提供一种输入来源。');
  }

  if (promptSource === undefined && promptText === undefined) {
    throw new Error('缺少 prompt 输入。请提供 prompt 文件路径、`-` 或 `--prompt-text`。');
  }

  const workdir = resolve(
    input.cwd,
    parsed.values.workdir ?? readEnv('WORKDIR') ?? '.'
  );

  const intervalSeconds = parsePositiveInteger(
    parsed.values['interval-seconds'] ?? readEnv('INTERVAL_SECONDS') ?? '3',
    'interval-seconds'
  );
  const progressFormat = parseProgressFormat(
    parsed.values['progress-format'] ?? readEnv('PROGRESS_FORMAT') ?? 'text'
  );

  const maxAttemptsValue = parsed.values['max-attempts'] ?? readEnv('MAX_ATTEMPTS');

  const fullAuto =
    parsed.values['full-auto'] ??
    parseBooleanEnvValue(readEnv('FULL_AUTO'), false);

  const dangerouslyBypass =
    parsed.values['dangerously-bypass'] ??
    parseBooleanEnvValue(readEnv('DANGEROUSLY_BYPASS'), true);

  const skipGitRepoCheck =
    parsed.values['skip-git-repo-check'] ??
    parseBooleanEnvValue(readEnv('SKIP_GIT_REPO_CHECK'), true);

  const stateDir = parsed.values['state-dir']
    ? resolve(input.cwd, parsed.values['state-dir'])
    : readEnv('STATE_DIR')
      ? resolve(input.cwd, readEnv('STATE_DIR') as string)
      : undefined;

  const maxAttempts =
    maxAttemptsValue === undefined
      ? undefined
      : parsePositiveInteger(maxAttemptsValue, 'max-attempts');

  const model = parsed.values.model ?? readEnv('MODEL');

  return {
    ...(promptSource === undefined ? {} : { promptSource }),
    ...(promptText === undefined ? {} : { promptText }),
    workdir,
    ...(stateDir === undefined ? {} : { stateDir }),
    intervalSeconds,
    progressFormat,
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    codexBin:
      parsed.values['codex-bin'] ??
      readEnv('CODEX_BIN') ??
      'codex',
    ...(model === undefined ? {} : { model }),
    confirmText:
      parsed.values['confirm-text'] ??
      readEnv('CONFIRM_TEXT') ??
      DEFAULT_CONFIRM_TEXT,
    resumeTextBase:
      parsed.values['resume-text-base'] ??
      readEnv('RESUME_TEXT_BASE') ??
      DEFAULT_RESUME_TEXT_BASE,
    fullAuto,
    dangerouslyBypass,
    skipGitRepoCheck
  };
}

function parsePositiveInteger(value: string, optionName: string): number {
  const numeric = Number.parseInt(value, 10);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${optionName} 必须是正整数，收到：${value}`);
  }

  return numeric;
}

function parseProgressFormat(value: string): 'text' | 'json' {
  if (value === 'text' || value === 'json') {
    return value;
  }

  throw new Error(
    `progress-format 只支持 text 或 json，收到：${value}`
  );
}
