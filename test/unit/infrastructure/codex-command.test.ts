import { describe, expect, it } from 'vitest';

import { buildCodexCommand } from '../../../src/infrastructure/codex/codex-command.js';

describe('buildCodexCommand', () => {
  it('会为 initial 模式生成稳定参数，并通过 stdin 传入 prompt', () => {
    const command = buildCodexCommand(
      {
        codexBin: 'codex',
        fullAuto: true,
        dangerouslyBypass: false,
        skipGitRepoCheck: true,
        model: 'gpt-5'
      },
      {
        mode: 'initial',
        workdir: '/repo',
        prompt: 'hello',
        outputLastMessagePath: '/state/last-message.txt',
        eventLogPath: '/state/events.jsonl',
        runnerLogPath: '/state/runner.log'
      }
    );

    expect(command.command).toBe('codex');
    expect(command.args).toEqual([
      'exec',
      '--json',
      '-o',
      '/state/last-message.txt',
      '--full-auto',
      '--skip-git-repo-check',
      '-m',
      'gpt-5',
      '-'
    ]);
    expect(command.input).toBe('hello');
  });

  it('会在 resume 模式下优先使用 session id，没有 session id 时退回 --last', () => {
    const withSessionId = buildCodexCommand(
      {
        codexBin: 'codex',
        fullAuto: false,
        dangerouslyBypass: true,
        skipGitRepoCheck: false
      },
      {
        mode: 'resume',
        workdir: '/repo',
        prompt: 'continue',
        outputLastMessagePath: '/state/last-message.txt',
        eventLogPath: '/state/events.jsonl',
        runnerLogPath: '/state/runner.log',
        sessionId: '11111111-1111-1111-1111-111111111111'
      }
    );

    const withoutSessionId = buildCodexCommand(
      {
        codexBin: 'codex',
        fullAuto: false,
        dangerouslyBypass: true,
        skipGitRepoCheck: false
      },
      {
        mode: 'resume',
        workdir: '/repo',
        prompt: 'continue',
        outputLastMessagePath: '/state/last-message.txt',
        eventLogPath: '/state/events.jsonl',
        runnerLogPath: '/state/runner.log'
      }
    );

    expect(withSessionId.args).toEqual([
      'exec',
      'resume',
      '--json',
      '-o',
      '/state/last-message.txt',
      '--dangerously-bypass-approvals-and-sandbox',
      '11111111-1111-1111-1111-111111111111',
      '-'
    ]);
    expect(withoutSessionId.args).toEqual([
      'exec',
      'resume',
      '--json',
      '-o',
      '/state/last-message.txt',
      '--dangerously-bypass-approvals-and-sandbox',
      '--last',
      '-'
    ]);
  });
});
