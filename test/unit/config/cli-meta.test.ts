import { describe, expect, it } from 'vitest';

import {
  isAiHelpRequest,
  isHelpRequest,
  isVersionRequest,
  readPackageVersion,
  renderAiHelpText,
  renderHelpText
} from '../../../src/config/cli-meta.js';

describe('cli-meta', () => {
  it('能识别帮助参数', () => {
    expect(isHelpRequest(['--help'])).toBe(true);
    expect(isHelpRequest(['-h'])).toBe(true);
    expect(isHelpRequest(['prompt.md'])).toBe(false);
  });

  it('能识别智能体帮助参数', () => {
    expect(isAiHelpRequest(['-ai'])).toBe(true);
    expect(isAiHelpRequest(['--ai-help'])).toBe(true);
    expect(isAiHelpRequest(['prompt.md'])).toBe(false);
  });

  it('能识别版本参数', () => {
    expect(isVersionRequest(['--version'])).toBe(true);
    expect(isVersionRequest(['-V'])).toBe(true);
    expect(isVersionRequest(['prompt.md'])).toBe(false);
  });

  it('会输出包含核心选项的帮助文本', () => {
    const text = renderHelpText();

    expect(text).toContain('codex-loop');
    expect(text).toContain('--state-dir');
    expect(text).toContain('--max-attempts');
    expect(text).toContain('--ai-help');
    expect(text).toContain('--no-full-auto');
    expect(text).not.toContain('--verify-cmd');
    expect(text).not.toContain('--verification-policy');
    expect(text).toContain('CODEX_LOOP_*');
  });

  it('会输出面向智能体的提示词生成协议', () => {
    const text = renderAiHelpText();

    expect(text).toContain('面向智能体的提示词生成协议');
    expect(text).toContain('先检索仓库上下文');
    expect(text).toContain('只生成 prompt');
    expect(text).toContain('不要执行 codex-loop');
    expect(text).toContain('由人工手动执行 CLI');
    expect(text).toContain('--prompt-text');
  });

  it('能读取 package.json 中的版本号', async () => {
    await expect(readPackageVersion()).resolves.toBe('1.0.0');
  });
});
