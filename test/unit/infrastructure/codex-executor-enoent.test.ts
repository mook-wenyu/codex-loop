import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const execaMock = vi.fn(() => {
  const error = new Error('missing command') as Error & {
    code?: string;
  };
  error.code = 'ENOENT';
  throw error;
});

vi.mock('execa', () => ({
  execa: execaMock
}));

const { ExecaCodexExecutor } = await import(
  '../../../src/infrastructure/codex/codex-executor.js'
);

const activeTempDirs: string[] = [];

afterEach(async () => {
  execaMock.mockClear();
  await Promise.all(
    activeTempDirs.map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
  activeTempDirs.length = 0;
});

describe('ExecaCodexExecutor ENOENT', () => {
  it('会把命令缺失错误转换为明确中文提示', async () => {
    const tempDir = await registerTempDir();
    const executor = new ExecaCodexExecutor({
      codexBin: 'codex-missing-for-test',
      fullAuto: false,
      dangerouslyBypass: true,
      skipGitRepoCheck: true
    });

    await expect(
      executor.execute({
        mode: 'initial',
        workdir: tempDir,
        prompt: '继续执行',
        outputLastMessagePath: join(tempDir, 'last-message.txt'),
        eventLogPath: join(tempDir, 'events.jsonl'),
        runnerLogPath: join(tempDir, 'runner.log')
      })
    ).rejects.toThrow('未找到 Codex 可执行文件：codex-missing-for-test');
    expect(execaMock).toHaveBeenCalledTimes(1);
  });
});

async function registerTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-loop-executor-'));
  activeTempDirs.push(directory);

  return directory;
}
