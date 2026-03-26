import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import { parseCliOptions } from '../../../src/config/options.js';

describe('parseCliOptions', () => {
  it('会解析位置参数、布尔开关与默认值', () => {
    const cwd = resolve('workspace', 'app');
    const result = parseCliOptions({
      argv: ['prompt.md'],
      cwd,
      env: {}
    });

    expect(result.promptSource).toBe('prompt.md');
    expect(result.workdir).toBe(cwd);
    expect(result.intervalSeconds).toBe(3);
    expect(result.progressFormat).toBe('text');
    expect(
      'verificationPolicy' in (result as unknown as Record<string, unknown>)
    ).toBe(false);
    expect(result.fullAuto).toBe(false);
    expect(result.dangerouslyBypass).toBe(true);
    expect(result.skipGitRepoCheck).toBe(true);
  });

  it('会让命令行参数覆盖环境变量', () => {
    const cwd = resolve('workspace', 'app');
    const result = parseCliOptions({
      argv: [
        'prompt.md',
        '--workdir',
        './repo',
        '--state-dir',
        './state',
        '--interval-seconds',
        '9',
        '--progress-format',
        'json',
        '--no-full-auto',
        '--no-dangerously-bypass',
        '--no-skip-git-repo-check',
        '--dangerously-bypass',
        '--max-attempts',
        '12',
      ],
      cwd,
      env: {
        CODEX_LOOP_WORKDIR: '/ignored',
        CODEX_LOOP_INTERVAL_SECONDS: '5',
        CODEX_LOOP_FULL_AUTO: 'true'
      }
    });

    expect(result.workdir).toBe(resolve(cwd, 'repo'));
    expect(result.stateDir).toBe(resolve(cwd, 'state'));
    expect(result.intervalSeconds).toBe(9);
    expect(result.progressFormat).toBe('json');
    expect(result.fullAuto).toBe(false);
    expect(result.dangerouslyBypass).toBe(true);
    expect(result.skipGitRepoCheck).toBe(false);
    expect(result.maxAttempts).toBe(12);
  });

  it('会拒绝缺失 prompt source 的输入', () => {
    expect(() =>
      parseCliOptions({
        argv: [],
        cwd: resolve('workspace', 'app'),
        env: {}
      })
    ).toThrow(/缺少 prompt 输入/i);
  });

  it('支持通过 --prompt-text 直接传入原始请求文本', () => {
    const cwd = resolve('workspace', 'app');
    const result = parseCliOptions({
      argv: ['--prompt-text', '直接执行这段任务文本'],
      cwd,
      env: {}
    });

    expect(result.promptText).toBe('直接执行这段任务文本');
    expect(result.promptSource).toBeUndefined();
  });

  it('支持通过环境变量配置 progress format', () => {
    const cwd = resolve('workspace', 'app');
    const result = parseCliOptions({
      argv: ['prompt.md'],
      cwd,
      env: {
        CODEX_LOOP_PROGRESS_FORMAT: 'json'
      }
    });

    expect(result.progressFormat).toBe('json');
  });

  it('会拒绝非法的 progress format', () => {
    expect(() =>
      parseCliOptions({
        argv: ['prompt.md', '--progress-format', 'yaml'],
        cwd: resolve('workspace', 'app'),
        env: {}
      })
    ).toThrow(/progress-format/i);
  });

  it('会拒绝已删除的外置验证选项', () => {
    const cwd = resolve('workspace', 'app');

    expect(() =>
      parseCliOptions({
        argv: [
          '--prompt-text',
          '直接执行这段任务文本',
          '--verify-cmd',
          'npm test'
        ],
        cwd,
        env: {}
      })
    ).toThrow();
  });

  it('会忽略已删除的外置验证环境变量', () => {
    const cwd = resolve('workspace', 'app');
    const result = parseCliOptions({
      argv: ['prompt.md'],
      cwd,
      env: {
        CODEX_LOOP_VERIFY_CMD: 'npm test\n\nnpm run build',
        CODEX_LOOP_VERIFICATION_POLICY: 'auto'
      }
    });

    expect(
      'verifyCommands' in (result as unknown as Record<string, unknown>)
    ).toBe(false);
    expect(
      'verificationPolicy' in (result as unknown as Record<string, unknown>)
    ).toBe(false);
  });

  it('会拒绝同时提供 promptSource 和 promptText', () => {
    expect(() =>
      parseCliOptions({
        argv: ['prompt.md', '--prompt-text', '直接执行这段任务文本'],
        cwd: resolve('workspace', 'app'),
        env: {}
      })
    ).toThrow(/互斥/i);
  });
});
