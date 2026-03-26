import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { runCli } from '../../src/cli-app.js';

describe('runCli', () => {
  it('在 -ai 下会直接输出智能体帮助并退出', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(
      ['-ai'],
      {},
      {
        stdout,
        stderr
      }
    );

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('面向智能体的使用协议');
    expect(stdout.text()).toContain('--prompt-text');
    expect(stderr.text()).toBe('');
  });

  it('在 --ai-help 下也会直接输出智能体帮助并退出', async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(
      ['--ai-help'],
      {},
      {
        stdout,
        stderr
      }
    );

    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain('先检索仓库上下文');
    expect(stderr.text()).toBe('');
  });
});

class MemoryStream extends Writable {
  readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.chunks.push(
      typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    );
    callback();
  }

  text(): string {
    return this.chunks.join('');
  }
}
