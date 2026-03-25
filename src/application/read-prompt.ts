import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface PromptInput {
  readonly promptSource?: string;
  readonly promptText?: string;
}

export async function resolvePromptText(
  input: PromptInput,
  cwd: string,
  stdin: NodeJS.ReadStream = process.stdin
): Promise<string> {
  if (input.promptSource !== undefined && input.promptText !== undefined) {
    throw new Error('promptSource 与 promptText 互斥，只能提供一种输入来源。');
  }

  if (input.promptText !== undefined) {
    return input.promptText;
  }

  if (input.promptSource === undefined) {
    throw new Error('缺少 prompt 输入。');
  }

  const promptSource = input.promptSource;

  if (promptSource === '-') {
    if (stdin.isTTY) {
      throw new Error('prompt source 为 `-`，但标准输入为空。');
    }

    return readFromStdin(stdin);
  }

  return readFile(resolve(cwd, promptSource), 'utf8');
}

async function readFromStdin(stdin: NodeJS.ReadStream): Promise<string> {
  let content = '';

  for await (const chunk of stdin) {
    content += chunk;
  }

  return content;
}
