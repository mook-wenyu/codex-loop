import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { resolvePromptText } from '../../../src/application/read-prompt.js';

const createdDirectories: string[] = [];

describe('resolvePromptText', () => {
  afterEach(async () => {
    await Promise.all(
      createdDirectories.map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
    createdDirectories.length = 0;
  });

  it('支持直接返回 promptText', async () => {
    await expect(
      resolvePromptText(
        { promptText: '直接执行最终目标。' },
        process.cwd()
      )
    ).resolves.toBe('直接执行最终目标。');
  });

  it('支持从文件读取 prompt', async () => {
    const directory = await createTempDirectory();
    const promptPath = join(directory, 'prompt.md');
    await writeFile(promptPath, '从文件读取的目标。', 'utf8');

    await expect(
      resolvePromptText(
        { promptSource: promptPath },
        process.cwd()
      )
    ).resolves.toBe('从文件读取的目标。');
  });

  it('支持从标准输入读取 prompt', async () => {
    const stdin = Readable.from(['从标准输入读取的目标。']) as NodeJS.ReadStream;
    stdin.isTTY = false;

    await expect(
      resolvePromptText(
        { promptSource: '-' },
        process.cwd(),
        stdin
      )
    ).resolves.toBe('从标准输入读取的目标。');
  });

  it('在缺少输入时会报错', async () => {
    await expect(
      resolvePromptText({}, process.cwd())
    ).rejects.toThrow(/缺少 prompt 输入/);
  });

  it('在同时提供 promptSource 和 promptText 时会报错', async () => {
    await expect(
      resolvePromptText(
        {
          promptSource: 'prompt.md',
          promptText: '直接执行'
        },
        process.cwd()
      )
    ).rejects.toThrow(/互斥/);
  });
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-loop-read-'));
  createdDirectories.push(directory);

  return directory;
}
